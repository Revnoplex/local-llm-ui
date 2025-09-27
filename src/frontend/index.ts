var responsePContent = '<p>Hello World</p>';
var responseP = document.getElementById('response-p');

function writeResponse(content: string, button: HTMLElement | null) {
    if (responseP) {
        console.log(content);
        responseP.innerHTML=content;
    }
    if (content != "Waiting for ollama server..." && button && button.textContent != "Generate LLM Response") {
        button.className = "btn";
        button.textContent = "Generate LLM Response";
    }
}

function handleClick() {
    const button = document.getElementById('requestButton');
    if (button) {
        button.className = "disabledBtn";
        button.textContent = "Fetching llm-response...";
    }
    const select = document.getElementById('modelSelect') as HTMLSelectElement;
    const input = document.getElementById('requestInput') as HTMLInputElement;
    const eventSource = new EventSource(`/query-llm?input=${input.value}&model=${select.value}`);
    eventSource.onmessage = (event) => {
        const data = event.data as string;
        if (data == '[Done]') {
            eventSource.close();
            return;
        }
        writeResponse(event.data, button)
    };

    eventSource.onerror = (error) => {
        let errorMsg = "<p>An Error Occured</p>";
        console.error('EventSource error:', error);
        const target = error.target as EventSource;
        EventSource.CONNECTING
        if (target.readyState === EventSource.CONNECTING) {
            errorMsg = "<p>Lost Connection To Backend!</p>"
        }
        writeResponse(errorMsg, button);
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