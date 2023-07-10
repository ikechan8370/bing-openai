const SydneyAIClient = require("./SydneyAIClient");

async function chat(body, onData) {
    const {stream, messages} = body
    let client = new SydneyAIClient.SydneyAIClient()
    let onProgress
    let partial
    if (stream) {
        partial = {
            "id": "chatcmpl-" + generateRandomString(30),
            "object": "chat.completion",
            "created": Math.floor(Date.now() / 1000),
            "model": "sydney-h3imaginative",
        }
        let init = false
        onProgress = (data => {
            if (!init) {
                onData(Object.assign(partial, {
                    choices: [
                        {
                            index: 0,
                            delta: {
                                content: "",
                                role: "assistant"
                            },
                            finish_reason: null
                        }
                    ]
                }))
                init = true
            }
            if (data) {
                onData(Object.assign(partial, {
                    choices: [
                        {
                            index: 0,
                            delta: {
                                content: data,
                            },
                            finish_reason: null
                        }
                    ]
                }))
            }
        })
    }
    messages.forEach(m => {
        if (m.role === 'assistant') {
            m.role = 'bot'
        }
        m.text = m.content
        delete m.content
    })
    let prompt = messages.pop().text
    let retry = 3
    let error
    while (retry >= 0) {
        try {
            let res = await client.sendMessage(prompt, messages, {onProgress})
            let text = res.response
            if (stream) {
                onData(Object.assign(partial, {
                    choices: [
                        {
                            index: 0,
                            delta: {
                                content: "",
                            },
                            finish_reason: "stop"
                        }
                    ]
                }))
            }
            return {
                "id": "chatcmpl-" + generateRandomString(30),
                "object": "chat.completion",
                "created": Math.floor(Date.now() / 1000),
                "model": "sydney-h3imaginative",
                "choices": [
                    {
                        "index": 0,
                        "message": {
                            "role": "assistant",
                            "content": text
                        },
                        "finish_reason": "stop"
                    }
                ],
                "usage": {
                    "prompt_tokens": 0,
                    "completion_tokens": 0,
                    "total_tokens": 0
                }
            }
        } catch (err) {
            error = err.message || err
            console.warn(err)
            retry--
        }
    }
    return {
        error
    }

}

function generateRandomString(length) {
    const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let randomString = '';

    for (let i = 0; i < length; i++) {
        const randomIndex = Math.floor(Math.random() * characters.length);
        randomString += characters.charAt(randomIndex);
    }

    return randomString;
}

module.exports = {
    chat
};