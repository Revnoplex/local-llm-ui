import express from 'express';
import type { NextFunction, Request, Response } from 'express';
import { Ollama } from "ollama";
import { Marked } from '@ts-stack/markdown';
import dotenv from 'dotenv';

dotenv.config({ quiet: true });

const ollamaServer = process.env.OLLAMA_SERVER?.trim() || (() => {
    const fallback = "http://127.0.0.1:11434";
    console.error(`Warning: Missing or invalid env variable OLLAMA_SERVER!\nDefaulting to ${fallback}`);
    return fallback;
})();

const port = process.env.PORT?.trim() && Number.isInteger(Number(process.env.PORT)) ? Number(process.env.PORT) : (() => {
    const fallback = 80;
    console.error(`Warning: Missing or invalid env variable PORT!\nDefaulting to port ${fallback}`);
    return fallback;
})();

const bindAddress = process.env.BIND_ADDRESS?.trim() || "0.0.0.0";

const ollama = new Ollama({ host: ollamaServer })

const app = express();

app.disable('x-powered-by');

app.use('/index.js', express.static('dist/frontend/index.js'));

app.use('/public', express.static('src/frontend/assets/'));

app.get('/', async (req: Request, res: Response, next: NextFunction) => {
    let selectMenu = '';
    let promptElements = '';

    try {
        const modelList = await ollama.list();
        selectMenu = '<select name="models" id="modelSelect">';
        modelList.models.forEach(model => {
            selectMenu += `<option class='modelOption' value="${model.name}">${model.name}</option>`;
        });
        selectMenu += '</select>'
        promptElements = '<button id="requestButton" class="btn">Generate LLM Response</button>';
    } catch (error) {
        selectMenu = `<p>Failed to list models! `
        promptElements = '<button id="requestButton" class="btn" disabled>Generate LLM Response</button>';
        if (
            error instanceof Error && 
            error.cause instanceof Error && 
            'errno' in error.cause && 
            'syscall' in error.cause && 
            typeof error.cause.errno === 'number' && 
            error.cause.syscall == 'connect'
        ) {
            selectMenu = `<p>Cannot connect to ollama server! Is it running? `
        }
        selectMenu+= `Refresh the page and try again.</p>`
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
        <h1 style='text-align: center;'>${title}</h1>
        <div id='response-p'>
            <p>&gt;</p>
        </div>
        <div class='input-console'>
            ${selectMenu}
            <input type="file" id="fileInput" hidden>
            <label for="fileInput" id="fileInputLabel" hidden>Upload</label> 
            <input type="text" id="requestInput" name="Request" placeholder="Send a message">
            <input type="checkbox" id="thinkingCheckbox" class="tkcbRelated" name="Thinking" value="enableThinking" hidden><label for="thinkingCheckbox" id="thinkingCheckboxLabel" class="tkcbRelated" hidden>Thinking</label>
            ${promptElements}
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
            res.status(404).send(`<h1>Model Not Found</h1><p>${error.message}</p>`)
        } else if (error instanceof Error && error.name === 'ResponseError'){
            res.status(502).send(`<h1>502 Bad Gateway</h1><p>The ollama server ran into an error: ${error.message}</p>`);
        } else {
            throw error;
        }
    }
    
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
    const response = await ollama.chat({
        model: `${model}`,
        messages: [{ role: 'user', content: `${input}`}],
        stream: true,
        think: thinking === 'true'
    })
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
    res.write(`data: [Done]\n\n`);
    res.end();
});

app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
    console.error(err.stack);
    let relativeError = err;
    if (err.cause instanceof Error) {
        relativeError = err.cause
    }
    res.status(500).send(`<head><title>500 Internal Server Error</title></head><body><h1>500 Internal Server Error</h1><p>${relativeError.message}</p></body>`)
})


app.listen(port, bindAddress, () => {
    console.log(`Server is running on http://localhost:${port}`);
});