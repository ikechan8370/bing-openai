const SydneyAIClient = require("./SydneyAIClient");

async function chat(body, onData) {
    let model = 'h3imaginative'
    const {stream, messages, functions,
        // model = 'h3imaginative'
    } = body
    let isFunctionResponse = messages[messages.length - 1].role === 'function'
    let client = new SydneyAIClient.SydneyAIClient({debug: true})
    let onProgress
    let partial
    let function_call = false
    if (stream) {
        partial = {
            "id": "chatcmpl-" + generateRandomString(30),
            "object": "chat.completion",
            "created": Math.floor(Date.now() / 1000),
            "model": "sydney-h3imaginative",
        }
        let init = false

        let dataSoFar = ''
        onProgress = (data => {
            dataSoFar += data
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
                if (function_call || dataSoFar.trimEnd().endsWith("Action:")) {
                    // stop stream to do function call
                    function_call = true
                } else if (isFunctionResponse) {
                   // do nothing
                } else {
                    if (data.trim() !== 'Action' && data.trim() !== 'Action:') {
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

                }
            }
        })
    }
    messages.forEach(m => {
        if (m.role === 'assistant') {
            m.role = 'bot'
        }
        m.text = m.content
        if (m.function_call) {
            m.text +=  '\nAction: ' + m.function_call.name + '\n' +
               'Action Input:' + m.function_call.arguments + '\n' +
                'Observation: 等待结果\n' +
                'Thought: 我现在不知道最终答案\n'
            m.text = m.text.trim()
        }
        if (m.role === 'function') {
            m.text = `Observation: the action ${m.name} execution result is: ` + m.content
            m.role = 'user'
        }
        delete m.content
        delete m.function_call
    })
    let prompt = messages.pop().text
    let toneOption = model
    if (prompt.startsWith('Summarize a short and relevant title of input with')) {
        // toneOption = 'h3precise'
        toneOption = 'sdgalileo'
    }
    let retry = 3
    let error
    while (retry >= 0) {
        try {
            let res = await client.sendMessage(prompt, messages, {onProgress, toneOption, functions})
            let text = res.response
            if (stream) {
                if (function_call) {
                    let [textContent = "", actionContent] = text.split("Action:", 2)
                    let [funcName, left] = actionContent.split("Action Input:", 2)
                    funcName = funcName.trim()
                    let arguments = left.split("Observation:")[0]
                    arguments = arguments.split("}\n")[0].trimEnd() + '}'
                    onData(Object.assign(partial, {
                        choices: [
                            {
                                index: 0,
                                delta: {
                                    function_call: {
                                        name: funcName,
                                        arguments: arguments
                                    }
                                },
                                finish_reason: null
                            }
                        ]
                    }))
                } else if (isFunctionResponse) {
                    let split = text.split('Final Answer:')
                    if (split.length > 1) {
                        text = split[1].trim()
                    }
                    onData(Object.assign(partial, {
                        choices: [
                            {
                                index: 0,
                                delta:  {
                                    content: text,
                                },
                                finish_reason: null
                            }
                        ]
                    }))
                }
                onData(Object.assign(partial, {
                    choices: [
                        {
                            index: 0,
                            delta: {
                                content: "",
                            },
                            finish_reason: function_call ? "function_call" : "stop"
                        }
                    ]
                }))
            }
            if (prompt.startsWith('Summarize a short and relevant title of input with')) {
                text = text.split('A possible title is:').pop().trim()
            }
            if (text.includes("Action:") && text.includes("Action Input:")) {
                let [textContent = "", actionContent] = text.split("Action:", 2)
                if (textContent.endsWith(":") || textContent.endsWith("：")) {
                    let juzi = textContent.split("。")
                    if (juzi.length > 1) {
                        juzi.pop()
                        textContent = juzi.join("。")
                    }
                }
                let [funcName, left] = actionContent.split("Action Input:", 2)
                funcName = funcName.trim()
                let arguments = left.split("Observation:")[0]
                arguments = arguments.split("}\n")[0].trimEnd() + '}'
                return {
                    "id": "chatcmpl-" + generateRandomString(30),
                    "object": "chat.completion",
                    "created": Math.floor(Date.now() / 1000),
                    "model": "sydney-" + toneOption,
                    "choices": [
                        {
                            "index": 0,
                            "message": {
                                "role": "assistant",
                                "content": textContent.trim(),
                                "function_call": {
                                    name: funcName,
                                    arguments
                                }
                            },
                            "finish_reason": "function_call"
                        }
                    ],
                    "usage": {
                        "prompt_tokens": 0,
                        "completion_tokens": 0,
                        "total_tokens": 0
                    }
                }
            }
            if (isFunctionResponse) {
                // 会包含Final Answer
                let split = text.split('Final Answer:')
                if (split.length > 1) {
                    text = split[1].trim()
                }
            }

            return {
                "id": "chatcmpl-" + generateRandomString(30),
                "object": "chat.completion",
                "created": Math.floor(Date.now() / 1000),
                "model": "sydney-" + toneOption,
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