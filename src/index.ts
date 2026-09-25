import express from 'express';
import type { NextFunction, Request, Response } from 'express';
import { Ollama, type Message } from "ollama";
import { Marked } from '@ts-stack/markdown';
import dotenv from 'dotenv';
import fs from 'fs';
import multer from 'multer';
import path from 'path';

interface VersionResponse {
    version: string
}

export interface ServerStatus {
    version: string,
    hostname: string
    port: string
}

interface ContextBank {
    [key: string]: Message[];
}

var contextBank: ContextBank = {};

var attachmentQueue: string[] = [];

dotenv.config({ quiet: true });

const upload = multer({ dest: 'attachments/' });

const ollamaServer = process.env.OLLAMA_SERVER?.trim() || (() => {
    const fallback = "http://127.0.0.1:11434";
    console.error(
        `Warning: Missing or invalid env variable OLLAMA_SERVER!\nDefaulting to ${fallback}`
    );
    return fallback;
})();

const port = process.env.PORT?.trim() && Number.isInteger(Number(process.env.PORT)) ? Number(process.env.PORT) : (() => {
    const fallback = 8080;
    console.error(
        `Warning: Missing or invalid env variable PORT!\nDefaulting to port ${fallback}`
    );
    return fallback;
})();

const bindAddress = process.env.BIND_ADDRESS?.trim() || "0.0.0.0";

const ollama = new Ollama({ host: ollamaServer });

const app = express();

app.disable('x-powered-by');

const HTTP_CODES = {
    200: "OK",
    204: "No Content",
    400: "Bad Request",
    401: "Unauthorized",
    404: "Not Found",
    500: "Internal Server Error",
    502: "Bad Gateway",
    503: "Service Unavailable",
} as const;


type HTTPCode = keyof typeof HTTP_CODES;

function validateHTTPCode(status: number): status is HTTPCode {
    return status in HTTP_CODES;
}

function displayStatus(status: number | null = null, title: string | null = null, description: string | null = null, themed: boolean = true) {
    let page = "<!DOCTYPE html>\n<html lang=\"en\">\n    <head>\n";
    if (themed) {
        page += "        <link rel=\"stylesheet\" type=\"text/css\" href=\"/css/main.css\">\n";
    }
    if (typeof title === "string" && title != '') {
        page += `        <title>${title}</title>\n    </head>\n    <body>\n        <h1>${title}</h1>\n`;
    }
    if (typeof description === "string" && description != '' && title === null && typeof status === "number" && validateHTTPCode(status)) {
        page += `        <title>${HTTP_CODES[status]}</title>\n    </head>\n    <body>\n        <h1>${status} ${HTTP_CODES[status]}</h1>\n        <p>${description}</p>\n`;
    } else if (typeof description === "string" && description != '' && title === null) {
        page += `        <title>${description}</title>\n    </head>\n    <body>\n        <p>${description}</p>\n`;
    } else if (typeof description === "string" && description != '') {
        page += `        <p>${description}</p>\n`;
    } else if (typeof status === "number" && validateHTTPCode(status) && title === null) {
        page += `        <title>${HTTP_CODES[status]}</title>\n    </head>\n    <body>\n        <h1>${status} ${HTTP_CODES[status]}</h1>\n`;
    } else if (title === null) {
        page += `        <title>Error</title>\n    </head>\n    <body>\n        <p>Unknown Error</p>\n`;
    }
    page+= "    </body>\n</html>\n";
    return page;
}

app.use([/\.map$|\.d\.ts$/, '/js'], express.static('dist/client'));

app.use(express.static('public'));

app.get('/', async (req: Request, res: Response, next: NextFunction) => {
    if (typeof req.socket.remoteAddress === "string" && !(req.socket.remoteAddress in contextBank)) {
        contextBank[req.socket.remoteAddress] = [];
    }
    const title = "Local LLM UI";
    let pageContents: string;
    try {
        pageContents = fs.readFileSync('src/views/index.html', 'utf8');
    } catch (error) {
        if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
            res.status(404).send(displayStatus(404, null, error.message));
        } else {
            throw error;
        }
        return
    }
    pageContents = pageContents.replaceAll("{title}", title);

    const charset: BufferEncoding = 'utf-8'
    res.writeHead(200, {
        'Content-Type': `text/html; charset=${charset}`,
        'Content-Length': Buffer.byteLength(pageContents, charset)
    });
    res.end(pageContents);
});

app.get('/probe-model', async (req: Request, res: Response, next: NextFunction) => {
    const model = req.query.model;
    if (!model) {
        res.status(400).send(displayStatus(400, null, "Model parameter is missing or blank"));
        return;
    }
    try {
        const modelInfo = await ollama.show({model: `${model}`});
        let strModelInfo = JSON.stringify(modelInfo);
        res.writeHead(200, {
            'Content-Type': `application/json`,
            'Content-Length': Buffer.byteLength(strModelInfo)
        });
        res.end(strModelInfo);
    } catch (error) {
        if (
            error instanceof Error && 
            error.name === 'ResponseError' && 
            'status_code' in error && 
            typeof error.status_code === 'number' && 
            error.status_code == 404
        ) {
            res.status(404).send(displayStatus(404, "Model Not Found", error.message));
        } else if (error instanceof Error && (error.name === 'ResponseError' || error.cause)){
            res.status(502).send(displayStatus(502, null, `The ollama server ran into an error: ${error instanceof Error? error.cause ?? error.message: "Unknown Error"}`));
        } else {
            if (error instanceof Error) {
                console.log(error.message);
            }
            throw error;
        }
    }
    
});

app.get('/list-models', async (req: Request, res: Response, next: NextFunction) => {
    let modelList = null;
    let errorAck = false;
    try {
        modelList = await ollama.list();
    } catch (error) {
        errorAck = true;
        res.status(502).send(displayStatus(
            502, null, 
            `The ollama server ran into an error: ${error instanceof Error? error.cause ?? error.message: "Unknown Error"}`
        ));
    }
    if (modelList !== null) {
        let strModelList = JSON.stringify(modelList.models);
        res.writeHead(200, {
            'Content-Type': `application/json`,
            'Content-Length': Buffer.byteLength(strModelList)
        });
        res.end(strModelList);
    } else if (!errorAck) {
        throw Error("Unexpected situation in list-models endpoint")
    }
    
});

app.get('/list-running-models', async (req: Request, res: Response, next: NextFunction) => {
    let modelList = null;
    let errorAck = false;
    try {
        modelList = await ollama.ps();
    } catch (error) {
        errorAck = true;
        res.status(502).send(displayStatus(
            502, null, 
            `The ollama server ran into an error: ${error instanceof Error? error.cause ?? error.message: "Unknown Error"}`
        ));
    }
    if (modelList !== null) {
        let strModelList = JSON.stringify(modelList.models);
        res.writeHead(200, {
            'Content-Type': `application/json`,
            'Content-Length': Buffer.byteLength(strModelList)
        });
        res.end(strModelList);
    } else if (!errorAck) {
        throw Error("Unexpected situation in list-models endpoint")
    }
    
});

app.get('/get-version', async (req: Request, res: Response, next: NextFunction) => {
    let versionRes = null;
    let errorAck = false;
    const parsedOllamaServer = new URL(ollamaServer);
    try {
        versionRes = await ollama.version();
    } catch (error) {
        errorAck = true;
        res.status(502).send(displayStatus(
            502, null, 
            `The ollama server ran into an error: ${error instanceof Error? error.cause ?? error.message: "Unknown Error"}`
        ));
    }
    if (versionRes !== null) {
        const serverStatus: ServerStatus = {
                "version": versionRes.version,
                "hostname": parsedOllamaServer.hostname,
                "port": parsedOllamaServer.port
            }
        let serverStatusString = JSON.stringify(serverStatus);
        res.writeHead(200, {
            'Content-Type': `application/json`,
            'Content-Length': Buffer.byteLength(serverStatusString)
        });
        res.write(serverStatusString);
        res.end();
    } else if (!errorAck) {
        throw Error("Unexpected situation in get-version endpoint")
    }
});

app.get('/query-llm', async (req: Request, res: Response, next: NextFunction) => {
    const input = req.query.input;
    const model = req.query.model;
    const thinking = req.query?.thinking || 'false';
    if ((!input) || !(model)) {
        res.status(400).send(displayStatus(400, null, "Input parameter is missing or blank"));
        return;
    }
    res.writeHead(200, {
        'Content-Type': `text/event-stream`,
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive'
    });
    res.write('data: <p id="waitMsg">Waiting for ollama server...</p>\n\n');
    let attachments: string[] = [];
    while (attachmentQueue.length > 0) {
        const attachmentFilename = attachmentQueue.shift();
        const imagePath = path.resolve(`attachments/${attachmentFilename}`);
        const imageBuffer = fs.readFileSync(imagePath);
        attachments.push(imageBuffer.toString('base64'));
        fs.unlink(imagePath, (err) => {
            console.error(
                `Couldn't delete attachment ${attachmentFilename}: ${err?.message ?? err}`
            );
        });
    }
    try {
        const message: Message = {
            role: 'user', 
            content: `${input}`, 
            images: attachments
        };
        const instanceId = req.socket?.remoteAddress ?? "__error__";
        contextBank[instanceId] ??= [];
        contextBank[instanceId].push(message);
        const response = await ollama.chat({
            model: `${model}`,
            messages: contextBank[instanceId],
            stream: true,
            think: thinking === 'true',
        });
        let full = '';
        let thinkingPart = '';
        let legacyThinking = false;
        let outputThinkingPart = '';
        let tmpClose = '';
        let checkBuffer = '';
        let thinkingDone = false;
        for await (const part of response) {
            checkBuffer += part.message.content;
            if (checkBuffer.includes("</think>")) {
                thinkingDone = true;
            }
            legacyThinking = checkBuffer.startsWith("<think>") && !checkBuffer.includes("</think>");
            if (legacyThinking) {
                outputThinkingPart = "<think>"+Marked.parse(checkBuffer.replace('<think>', '').replace("</think", "")).replaceAll("\n", "&#10;")+"</think>";
            } else if (part.message.thinking) {
                thinkingPart += part.message.thinking;
                outputThinkingPart = "<think>"+Marked.parse(thinkingPart).replaceAll("\n", "&#10;")+"</think>";
            } else if ((!checkBuffer.startsWith('<')) || thinkingDone) {
                if (part.message.content.startsWith(">\n")) {
                    full+= part.message.content.replace(">", "");
                } else {
                    full+= part.message.content;
                }
            }

            let rawSBTMatches = full.split("`").length - 1;
            let tBTMatches = full.split("```").length - 1;
            let sBTMatches = rawSBTMatches - 3*tBTMatches;
            if (sBTMatches & 1 && !(tBTMatches & 1)) {
                tmpClose = '`';
            } else if (tBTMatches & 1) {
                tmpClose = '```';
            }
            res.write(`data: ${outputThinkingPart+Marked.parse(full+tmpClose).replaceAll("\n", "&#10;")}\n\n`);
            tmpClose = '';
        }
        contextBank[instanceId].push({'role': 'assistant', 'content': checkBuffer, 'thinking': thinkingPart});
    } catch (error) {
        if (error instanceof Error && (error.name === 'ResponseError' || error.cause)) {
            res.write(`data: [Error]: ${error instanceof Error ? error.cause ?? error.message : "Unknown Error"}\n\n`);
            res.end();
            return;
        } else {
            throw error;
        }
    }
    res.write(`data: [Done]\n\n`);
    res.end();
});

app.post('/register-attachment', upload.array('attachments[]'), async (req: Request, res: Response, next: NextFunction) => {
    if (!req.files) {
        res.status(400).send("Attachment is missing!");
        return;
    }
    for (const file of req.files as Express.Multer.File[]) {
        attachmentQueue.push(file.filename);
    }
    res.status(204).send(displayStatus(204));
});

app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
    let relativeError = err;
    if (err.cause instanceof Error) {
        relativeError = err.cause
    }
    console.error(relativeError.stack);
    if (res.headersSent) {
        res.write(`data: [Error]: Internal Server Error: ${relativeError.message}\n\n`);
        res.end();
        return;
    }
    res.status(500).send(displayStatus(500, null, relativeError.message));
});


app.listen(port, bindAddress, () => {
    if (bindAddress == "0.0.0.0") {
        console.log(`Server is running on http://127.0.0.1:${port}`);
    } else {
        console.log(`Server is running on http://127.0.0.1:${port} listening to ${bindAddress}`);
    }
});
