import express from 'express';
import type { NextFunction, Request, Response } from 'express';
import { Ollama } from "ollama";

const ollama = new Ollama({ host: 'http://192.168.100.43:11434' })

const app = express();
const port: number = 3000;

app.disable('x-powered-by');

app.use(express.static('dist/frontend'))

app.get('/', async (req: Request, res: Response, next: NextFunction) => {
    const modelList = await ollama.list();
    let selectMenu = '<select name="models" id="modelSelect">';
    modelList.models.forEach(model => {
      selectMenu += `<option value="${model.name}">${model.name}</option>`;
    });
    selectMenu += '</select>'
    const pageContents: string = `<head><title>Local LLM UI</title><script type="module" src="/index.js" defer></script></head><body><h1>Local LLM UI</h1>${selectMenu}<br><input type="text" id="requestInput" name="Request" placeholder="Send a message"><br><button id="requestButton">Generate LLM Response</button><p id='response-p'>Response Will Appear here</p></body>`;
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
    res.write('data: Waiting for ollama server...\n\n');
    const response = await ollama.chat({
        model: `${model}`,
        messages: [{ role: 'user', content: `${input}`}],
        stream: true
    })
    res.write('data: Ready\n\n');
    for await (const part of response) {
        res.write(`data: ${part.message.content}\n\n`);
    }
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
app.listen(port, () => {
    console.log(`Server is running on http://localhost:${port}`);
});