var responsePContent = '<p>Hello World</p>';
var responseP = document.getElementById('response-p');

function writeResponse(content: string, button: HTMLElement | null) {
    if (responseP) {
        if (content == "Waiting for ollama server...") {
            responseP.innerHTML=content;
        } else if (content == "Ready") {
            responseP.innerHTML="";
        } else {
            responseP.innerHTML+=content;
        }
        
    }
    if (button) {
        button.textContent = "Generate LLM Response";
    }
}

function handleClick() {
    // You can add more complex logic here
    const button = document.getElementById('requestButton');
    if (button) {
        button.textContent = "Fetching llm-response...";
    }
    const select = document.getElementById('modelSelect') as HTMLSelectElement;
    const input = document.getElementById('requestInput') as HTMLInputElement;
    const eventSource = new EventSource(`/query-llm?input=${input.value}&model=${select.value}`);
    eventSource.onmessage = (event) => {
        const data = event.data as string;
        writeResponse(event.data, button)
    };

    eventSource.onerror = (error) => {
        console.error('EventSource error:', error);
        eventSource.close();
    };
}

// Add an event listener to the button once the DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    const button = document.getElementById('requestButton');
    if (button) {
        button.addEventListener('click', handleClick);
    }
});