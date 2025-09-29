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
    if (input) {
        input.setAttribute('disabled', '');
    }
    const eventSource = new EventSource(`/query-llm?input=${input.value}&model=${select.value}`);
    eventSource.onmessage = (event) => {
        const data = event.data as string;
        if (data == '[Done]') {
            eventSource.close();
            return;
        }
        writeResponse(event.data, button, input)
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

// Add an event listener to the button once the DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    const button = document.getElementById('requestButton');
    const input = document.getElementById('requestInput')
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
});