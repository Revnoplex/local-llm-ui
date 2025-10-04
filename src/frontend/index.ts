import type { ShowResponse } from "ollama";
var responsePContent = '<p>Hello World</p>';
var responseP = document.getElementById('response-p');
var attachment = '';

function writeResponse(content: string, button: HTMLElement | null, input: HTMLElement | null) {
    if (responseP) {
        responseP.innerHTML=content;
    }
    if ((!content.includes('<p id="waitMsg">')) && button && button.textContent != "Generate LLM Response") {
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
            attachment = '';
            eventSource.close();
            return;
        }
        if (data.startsWith('[Error]:')) {
            writeResponse(attachment+promptInput+"<p>"+event.data.replace("[Error]: ", "<strong>Couldn't Generate Response: </strong>")+"</p>", button, input);
            attachment = '';
            eventSource.close();
            return;
        }
        writeResponse(attachment+promptInput+event.data, button, input)
    };

    eventSource.onerror = (error) => {
        let errorMsg = "<p>An Error Occured</p>";
        console.error('EventSource error:', error);
        const target = error.target as EventSource;
        EventSource.CONNECTING
        if (target.readyState === EventSource.CONNECTING) {
            errorMsg = "<p>Lost Connection To Backend Or The Backend Encountered An Error!</p>"
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
    const fileInputLabel = document.getElementById("fileInputLabel");
    if (fileInputLabel && data.capabilities.includes('vision')) {
        fileInputLabel.removeAttribute("hidden");
    } else if (fileInputLabel) {
        fileInputLabel.setAttribute("hidden", '');
    }
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

function registerAttachment(event: Event) {
    const target = event.target as HTMLInputElement;
    if (target && target.files && target.files.length > 0 && target.files[0]) {
        const formData = new FormData();
        let successfulAttachments: string[] = [];
        for (const firstFile of target.files) {
            if (!(["image/jpeg", "image/png"].includes(firstFile.type))) {
                if (responseP) {
                    responseP.innerHTML=`<p>Couldn't Attach <strong>${firstFile.name}</strong>: Not a valid image format! Only png and jpeg are supported.</p>`+(responseP?.innerHTML || "");
                }
                continue;
            }
            formData.append('attachments[]', firstFile, firstFile.name);
            successfulAttachments.push(firstFile.name);
        }
        fetch(`/register-attachment`, {
            method: "POST",
            body: formData
        })
        .then(response => {
            if (!response.ok) {
                throw new Error(`HTTP Error ${response.status}`);
            }
            return response.text();
        })
        .then((json) => {
            for (const filename of successfulAttachments) {
                const tmpAttachment = "<p><strong>Attached:</strong> "+filename+"</p>";
                attachment += tmpAttachment;
                if (responseP) {
                    responseP.innerHTML=tmpAttachment+(responseP?.innerHTML || "");
                }
            }
        })
        .catch(error => {
            console.error('Failed to upload attachment:', error);
        });
        
    }
}

// Add an event listener to the button once the DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    const button = document.getElementById('requestButton');
    const input = document.getElementById('requestInput');
    const select = document.getElementById('modelSelect') as HTMLScriptElement;
    const upload = document.getElementById('fileInput');
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
    if (upload) {
        upload.addEventListener('change', registerAttachment)
    }
});