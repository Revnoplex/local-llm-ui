import express from 'express';
import type { NextFunction, Request, Response } from 'express';
import { Ollama, type Message } from "ollama";
import { Marked } from '@ts-stack/markdown';
import dotenv from 'dotenv';
import fs from 'fs';
import multer from 'multer';
import path from 'path';
import http from 'http';

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
    const fallback = 80;
    console.error(
        `Warning: Missing or invalid env variable PORT!\nDefaulting to port ${fallback}`
    );
    return fallback;
})();

const bindAddress = process.env.BIND_ADDRESS?.trim() || "0.0.0.0";

const ollama = new Ollama({ host: ollamaServer });

const app = express();

app.disable('x-powered-by');

app.use('/index.js', express.static('dist/frontend/index.js'));

app.use('/public', express.static('src/frontend/assets/'));

app.get('/', async (req: Request, res: Response, next: NextFunction) => {
    if (typeof req.socket.remoteAddress === "string" && !(req.socket.remoteAddress in contextBank)) {
        contextBank[req.socket.remoteAddress] = [];
    }
    const title = "Local LLM UI";
    const pageContents: string = `\
<!DOCTYPE html>
<html lang="en">
    <head>
        <title>${title}</title>
        <script type="module" src="/index.js" defer></script>
        <link rel="stylesheet" type="text/css" href="/public/style.css">
    </head>
    <body>
        <div class="status-bar">
            <p id="modelStatus" class="status-bar-element">Model Status Will Appear here</p>
            <h1 style='text-align: center;'>${title}</h1>
            <p id="ollamaStatus" class="status-bar-element" style="text-align: right"></p>
        </div>
        <div id='response-p'>
            <p>&gt;</p>
        </div>
        <div class='input-console'>
            <select name="models" id="modelSelect" disabled>
                <option class='modelOption' value="">Fetching Models...</option>
            </select>
            <button id="listModelsRetryButton" class="btn" hidden>Retry</button>
            <input type="file" id="fileInput" hidden multiple>
            <label for="fileInput" id="fileInputLabel" hidden>Upload</label> 
            <input type="text" id="requestInput" name="Request" placeholder="Please select a model first" disabled>
            <input type="checkbox" id="thinkingCheckbox" class="tkcbRelated" name="Thinking" value="enableThinking" hidden>
            <label for="thinkingCheckbox" id="thinkingCheckboxLabel" class="tkcbRelated" hidden>Thinking</label>
            <button id="requestButton" class="btn" disabled>Generate Response</button>
        </div>
    </body>
</html>\
    `;
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
        res.status(400).send('<h1>400 Bad Request</h1><p>Model parameter is missing or blank</p>');
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
            res.status(404).send(`<h1>Model Not Found</h1><p>${error.message}</p>`);
        } else if (error instanceof Error && error.name === 'ResponseError'){
            res.status(502).send(
                `<h1>502 Bad Gateway</h1><p>The ollama server ran into an error: ${error.message}</p>`
            );
        } else {
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
        res.status(502).send(
            `<h1>502 Bad Gateway</h1><p>The ollama server ran into an error: ${error instanceof Error? error.cause ?? error.message: "Unknown Error"}</p>`
        );
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
        res.status(502).send(
            `<h1>502 Bad Gateway</h1><p>The ollama server ran into an error: ${error instanceof Error? error.cause ?? error.message: "Unknown Error"}</p>`
        );
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
    const parsedOllamaServer = new URL(ollamaServer);
    const request = http.request({
        hostname: parsedOllamaServer.hostname,
        port: parsedOllamaServer.port,
        path: '/api/version',
        method: 'GET'
    }, (response) => {
        let data = '';

        response.on('data', (chunk) => {
            data += chunk;
        });

        response.on('end', () => {
            const parsedData: VersionResponse = JSON.parse(data);
            const serverStatus: ServerStatus = {
                "version": parsedData.version,
                "hostname": parsedOllamaServer.hostname,
                "port": parsedOllamaServer.port
            }
            let serverStatusString = JSON.stringify(serverStatus);
            res.writeHead(200, {
                'Content-Type': `application/json`,
                'Content-Length': Buffer.byteLength(serverStatusString)
            });
            res.write(serverStatusString);
        });
    });

    request.on('error', (error) => {
        res.status(502).send(
            `<h1>502 Bad Gateway</h1><p>The ollama server ran into an error: ${error instanceof Error? error.cause ?? error.message: "Unknown Error"}</p>`
        );
    });

    request.end();
});

app.get('/query-llm', async (req: Request, res: Response, next: NextFunction) => {
    const input = req.query.input;
    const model = req.query.model;
    const thinking = req.query?.thinking || 'false';
    if ((!input) || !(model)) {
        res.status(400).send('<h1>400 Bad Request</h1><p>Input parameter is missing or blank</p>');
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
        if (error instanceof Error && error.name === 'ResponseError') {
            res.write(`data: [Error]: ${error.message}\n\n`);
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
    res.status(204).send("No response");
});

app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
    console.error(err.stack);
    let relativeError = err;
    if (err.cause instanceof Error) {
        relativeError = err.cause
    }
    res.status(500).send(`\
<head>
    <title>500 Internal Server Error</title>
</head>
<body>
    <h1>500 Internal Server Error</h1>
    <p>${relativeError.message}</p>
</body>\
`
    );
});


app.listen(port, bindAddress, () => {
    if (bindAddress == "0.0.0.0") {
        console.log(`Server is running on http://127.0.0.1:${port}`);
    } else {
        console.log(`Server is running on http://127.0.0.1:${port} listening to ${bindAddress}`);
    }
});
