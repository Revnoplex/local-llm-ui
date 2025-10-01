import type { ShowResponse } from "ollama";
var responsePContent = '<p>Hello World</p>';
var responseP = document.getElementById('response-p');

function writeResponse(content: string, button: HTMLElement | null, input: HTMLElement | null) {
    if (responseP) {
        responseP.innerHTML=content;
    }
    if (content != "<p>Waiting for ollama server...</p>" && button && button.textContent != "Generate LLM Response") {
        button.removeAttribute('disabled');
        button.textContent = "Generate LLM Response";
        if (input) {
            input.removeAttribute('disabled');
        }
    }
}

function handleClick() {
    const button = document.getElementById('requestButton');
    if (button) {
        button.setAttribute('disabled', '');
        button.textContent = "Fetching llm-response...";
    }
    const select = document.getElementById('modelSelect') as HTMLSelectElement;
    const input = document.getElementById('requestInput') as HTMLInputElement;
    const thinkingCheckbox = document.getElementById('thinkingCheckbox') as HTMLInputElement;
    if (input) {
        input.setAttribute('disabled', '');
    }
    const eventSource = new EventSource(`/query-llm?input=${input.value}&model=${select.value}&thinking=${thinkingCheckbox.checked && !thinkingCheckbox.hidden}`);
    let promptInput = `<p>&gt; ${input.value}</p>`;
    input.value = '';
    eventSource.onmessage = (event) => {
        const data = event.data as string;
        if (data == '[Done]') {
            eventSource.close();
            return;
        }
        writeResponse(promptInput+event.data, button, input)
    };

    eventSource.onerror = (error) => {
        let errorMsg = "<p>An Error Occured</p>";
        console.error('EventSource error:', error);
        const target = error.target as EventSource;
        EventSource.CONNECTING
        if (target.readyState === EventSource.CONNECTING) {
            errorMsg = "<p>Lost Connection To Backend!</p>"
        }
        writeResponse((responseP?.innerHTML || "")+errorMsg, button, input);
        eventSource.close();
    };
}

function processModelInfo(data: ShowResponse) {
    const supportsThinnking = data.capabilities.includes('thinking');
    for (const element of document.querySelectorAll(".tkcbRelated")) {
        if (supportsThinnking) {
            element.removeAttribute("hidden");
        } else {
            element.setAttribute("hidden", '');
        }
            
    }
    // Multimodal support not yet implemented
    // const fileInputLabel = document.getElementById("fileInputLabel");
    // if (fileInputLabel && data.capabilities.includes('vision')) {
    //     fileInputLabel.removeAttribute("hidden");
    // } else if (fileInputLabel) {
    //     fileInputLabel.setAttribute("hidden", '');
    // }
}

function fetchModelInfo(model: string) {
    fetch(`/probe-model?model=${model}`)
    .then(response => {
    if (!response.ok) {
        throw new Error(`HTTP Error ${response.status}`);
    }
    return response.json();
    })
    .then((json) => processModelInfo(json as ShowResponse))
    .catch(error => {
        console.error('Unable to fetch model info:', error);
    });
}

// Add an event listener to the button once the DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    const button = document.getElementById('requestButton');
    const input = document.getElementById('requestInput');
    const select = document.getElementById('modelSelect') as HTMLScriptElement;
    if (button) {
        button.addEventListener('click', handleClick);
    }
    if (input) {
        input.addEventListener('keydown', (event) => {
            if (event.key === 'Enter') {
                handleClick();
            }
        });
    }
    if (select && 'value' in select && typeof select.value === 'string') {
        fetchModelInfo(select.value);
        select.addEventListener('change', (event) => {
            if (event.target !== null && 'value' in event.target && typeof event.target.value === 'string') {
                fetchModelInfo(event.target.value);
            }
        });
    }
});