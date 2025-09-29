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
        selectMenu += `<option value="${model.name}">${model.name}</option>`;
        });
        selectMenu += '</select>'
        promptElements = '<button id="requestButton" class="btn">Generate LLM Response</button>';
    } catch (error) {
        selectMenu = `<p>Failed to list models!</p>`
        promptElements = '<button id="requestButton" class="btn" disabled>Generate LLM Response</button>';
        if (error instanceof Error) {
            if (error.cause instanceof Error && 'errno' in error.cause && 'syscall' in error.cause) {
                error.cause as NodeJS.ErrnoException;
                if (typeof error.cause.errno === 'number' && error.cause.syscall == 'connect') {
                    selectMenu = `<p>Cannot connect to ollama server! Is it running?</p>`
                }
            }
        }
        selectMenu+= `<p>Refresh the page to try again.</p>`
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
        <h1>${title}</h1>
        <div id='response-p'>
            <p>Response Will Appear here</p>
        </div>
        <div class='input-console'>
            ${selectMenu}
            <input type="text" id="requestInput" name="Request" placeholder="Send a message">
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
    // res.status(200).send('<h1>Hello, World!</h1>');
});

app.get('/query-llm', async (req: Request, res: Response, next: NextFunction) => {
    const input = req.query.input;
    const model = req.query.model;
    if ((!input) || !(model)) {
        res.status(400).send('<h1>400 Bad Request</h1><p>Input parameter is missing or blank</p>');
        return;
    }
    res.writeHead(200, {
        'Content-Type': `text/event-stream`,
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive'
    });
    res.write('data: <p>Waiting for ollama server...</p>\n\n');
    const response = await ollama.chat({
        model: `${model}`,
        messages: [{ role: 'user', content: `${input}`}],
        stream: true
    })
    let full = '';
    let thinkingPart = '';
    let thinking = false;
    let tmpClose = '';
    for await (const part of response) {
        thinking = part.message.content == "<think>" || (thinking && part.message.content != "</think>")
        if (thinking) {
            thinkingPart += part.message.content;
        } else {
            full+= part.message.content;
        }

        let rawSBTMatches = full.split("`").length - 1;
        let tBTMatches = full.split("```").length - 1;
        let sBTMatches = rawSBTMatches - 3*tBTMatches;
        if (sBTMatches & 1 && !(tBTMatches & 1)) {
            tmpClose = '`';
        } else if (tBTMatches & 1) {
            tmpClose = '```';
        }
        res.write(`data: ${"<p>"+thinkingPart.replaceAll("\n", "<br>")+"</p>"+Marked.parse(full+tmpClose).replaceAll("\n", "&#10;")}\n\n`);
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

// Start the Express server
app.listen(port, bindAddress, () => {
    console.log(`Server is running on http://localhost:${port}`);
});