var responsePContent = '<p>Hello World</p>';
var responseP = document.getElementById('response-p');

function writeResponse(content: string, button: HTMLElement | null) {
    if (responseP) {
        responseP.innerHTML=content;
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
    fetch(`/query-llm?input=${input.value}&model=${select.value}`)
    .then(response => {
        if (!response.ok) {
            throw new Error(`HTTP Error ${response.status}`);
        }
        return response.text();
    })
    .then((responseContent) => writeResponse(responseContent, button));
}

// Add an event listener to the button once the DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    const button = document.getElementById('requestButton');
    if (button) {
        button.addEventListener('click', handleClick);
    }
});