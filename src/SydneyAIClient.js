const fetch = require('node-fetch');
const crypto = require('crypto');
const WebSocket = require('ws');
const moment = require('moment');

if (!globalThis.fetch) {
  globalThis.fetch = fetch
  globalThis.Headers = Headers
  globalThis.Request = Request
  globalThis.Response = Response
}

/**
 * https://stackoverflow.com/a/58326357
 * @param {number} size
 */
const genRanHex = (size) => [...Array(size)].map(() => Math.floor(Math.random() * 16).toString(16)).join('')

class SydneyAIClient {
  constructor (opts = {}) {
    this.opts = {
      ...opts,
      host: 'https://bing.roki.best'
    }
    this.debug = opts.debug
  }

  async createNewConversation () {
    const fetchOptions = {
      headers: {
        accept: 'application/json',
        'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8,en-GB;q=0.7,en-US;q=0.6',
        'content-type': 'application/json',
        'sec-ch-ua': '"Microsoft Edge";v="113", "Chromium";v="113", "Not-A.Brand";v="24"',
        // 'sec-ch-ua-arch': '"x86"',
        // 'sec-ch-ua-bitness': '"64"',
        // 'sec-ch-ua-full-version': '"112.0.1722.7"',
        // 'sec-ch-ua-full-version-list': '"Chromium";v="112.0.5615.20", "Microsoft Edge";v="112.0.1722.7", "Not:A-Brand";v="99.0.0.0"',
        'sec-ch-ua-mobile': '?0',
        // 'sec-ch-ua-model': '',
        'sec-ch-ua-platform': '"macOS"',
        // 'sec-ch-ua-platform-version': '"15.0.0"',
        'sec-fetch-dest': 'empty',
        'sec-fetch-mode': 'cors',
        'sec-fetch-site': 'same-origin',
        'x-ms-client-request-id': crypto.randomUUID(),
        'x-ms-useragent': 'azsdk-js-api-client-factory/1.0.0-beta.1 core-rest-pipeline/1.10.3 OS/macOS',
        // cookie: this.opts.cookies || `_U=${this.opts.userToken}`,
        Referer: 'https://edgeservices.bing.com/edgesvc/chat?udsframed=1&form=SHORUN&clientscopes=chat,noheader,channelstable,',
        'Referrer-Policy': 'origin-when-cross-origin',
        // Workaround for request being blocked due to geolocation
        'x-forwarded-for': '1.1.1.1'
      }
    }
    console.log('使用host：' + this.opts.host)
    let response = await fetch(`${this.opts.host}/turing/conversation/create`, fetchOptions)
    let text = await response.text()
    let retry = 10
    while (retry >= 0 && response.status === 200 && !text) {
      await delay(400)
      response = await fetch(`${this.opts.host}/turing/conversation/create`, fetchOptions)
      text = await response.text()
      retry--
    }
    if (response.status !== 200) {
      console.error('创建sydney对话失败: status code: ' + response.status + response.statusText)
      console.error('response body：' + text)
      throw new Error('创建sydney对话失败: status code: ' + response.status + response.statusText)
    }
    try {
      return JSON.parse(text)
    } catch (err) {
      console.error('创建sydney对话失败: status code: ' + response.status + response.statusText)
      console.error(text)
      throw new Error(text)
    }
  }

  async createWebSocketConnection () {
    return new Promise((resolve, reject) => {
      let agent
      let sydneyHost = this.opts.host.replace('https://', 'wss://').replace('http://', 'ws://')

      console.log(`use sydney websocket host: ${sydneyHost}`)
      let ws = new WebSocket(sydneyHost + '/sydney/ChatHub', undefined, { agent, origin: 'https://edgeservices.bing.com' })
      ws.on('error', (err) => {
        console.error(err)
        reject(err)
      })

      ws.on('open', () => {
        if (this.debug) {
          console.debug('performing handshake')
        }
        ws.send('{"protocol":"json","version":1}')
      })

      ws.on('close', () => {
        if (this.debug) {
          console.debug('disconnected')
        }
      })

      ws.on('message', (data) => {
        const objects = data.toString().split('')
        const messages = objects.map((object) => {
          try {
            return JSON.parse(object)
          } catch (error) {
            return object
          }
        }).filter(message => message)
        if (messages.length === 0) {
          return
        }
        if (typeof messages[0] === 'object' && Object.keys(messages[0]).length === 0) {
          if (this.debug) {
            console.debug('handshake established')
          }
          // ping
          ws.bingPingInterval = setInterval(() => {
            ws.send('{"type":6}')
            // same message is sent back on/after 2nd time as a pong
          }, 15 * 1000)
          resolve(ws)
          return
        }
        if (this.debug) {
          console.debug(JSON.stringify(messages))
          console.debug()
        }
      })
    })
  }

  async cleanupWebSocketConnection (ws) {
    clearInterval(ws.bingPingInterval)
    ws.close()
    ws.removeAllListeners()
  }

  async sendMessage (
    message,
    previousMessages = [],
    opts = {}
  ) {
    let {
      conversationSignature,
      conversationId,
      clientId,
      invocationId = 0,
      parentMessageId = invocationId || crypto.randomUUID(),
      onProgress,
      context,
      abortController = new AbortController(),
      timeout = 20000,
      firstMessageTimeout = 40000,
      messageType = 'Chat'
    } = opts
    // if (messageType === 'Chat') {
    //   console.warn('该Bing账户token已被限流，降级至使用非搜索模式。本次对话AI将无法使用Bing搜索返回的内容')
    // }
    if (typeof onProgress !== 'function') {
      onProgress = () => {}
    }
    if (parentMessageId || !conversationSignature || !conversationId || !clientId) {
      const createNewConversationResponse = await this.createNewConversation()
      if (this.debug) {
        console.debug(createNewConversationResponse)
      }
      if (createNewConversationResponse.result?.value === 'UnauthorizedRequest') {
        throw new Error(`UnauthorizedRequest: ${createNewConversationResponse.result.message}`)
      }
      if (!createNewConversationResponse.conversationSignature || !createNewConversationResponse.conversationId || !createNewConversationResponse.clientId) {
        const resultValue = createNewConversationResponse.result?.value
        if (resultValue) {
          throw new Error(`${resultValue}: ${createNewConversationResponse.result.message}`)
        }
        throw new Error(`Unexpected response:\n${JSON.stringify(createNewConversationResponse, null, 2)}`)
      }
      ({
        conversationSignature,
        conversationId,
        clientId
      } = createNewConversationResponse)
    }
    if (previousMessages.length > 0 && previousMessages[0].role === 'system') {
      previousMessages[0].role = 'bot'
      previousMessages.splice(1, 0, {
        role: 'bot',
        text: 'ok'
      })
    }
    let pm = []
    // 无限续杯
    let exceedConversations = []
    previousMessages.reverse().forEach(m => {
      if (pm.filter(m => m.author === 'user').length < global.maxNumUserMessagesInConversation - 1) {
        pm.push(m)
      } else {
        exceedConversations.push(m)
      }
    })
    pm = pm.reverse()

    const userMessage = {
      id: crypto.randomUUID(),
      parentMessageId,
      role: 'User',
      message
    }
    const ws = await this.createWebSocketConnection()
    console.log('sydney websocket constructed successful')
    const toneOption = 'h3imaginative'
    let optionsSets = [
      'nlu_direct_response_filter',
      'deepleo',
      'disable_emoji_spoken_text',
      'responsible_ai_policy_235',
      'enablemm',
      toneOption,
      'dagslnv1',
      'sportsansgnd',
      'dl_edge_desc',
      'noknowimg',
      // 'dtappid',
      // 'cricinfo',
      // 'cricinfov2',
      'dv3sugg',
      'gencontentv3'
    ]

    const currentDate = moment().format('YYYY-MM-DDTHH:mm:ssZ')

    const obj = {
      arguments: [
        {
          source: 'cib',
          optionsSets,
          allowedMessageTypes: ['ActionRequest', 'Chat', 'Context',
            // 'InternalSearchQuery', 'InternalSearchResult', 'Disengaged', 'InternalLoaderMessage', 'Progress', 'RenderCardRequest', 'AdsQuery',
            'SemanticSerp', 'GenerateContentQuery', 'SearchQuery'],
          sliceIds: [],
          traceId: genRanHex(32),
          isStartOfSession: invocationId === 0,
          message: {
            locale: 'zh-CN',
            market: 'zh-CN',
            region: 'HK',
            location: 'lat:47.639557;long:-122.128159;re=1000m;',
            locationHints: [
              {
                Center: {
                  Latitude: 39.971031896331,
                  Longitude: 116.33522679576237
                },
                RegionType: 2,
                SourceType: 11
              },
              {
                country: 'Hong Kong',
                timezoneoffset: 8,
                countryConfidence: 9,
                Center: {
                  Latitude: 22.15,
                  Longitude: 114.1
                },
                RegionType: 2,
                SourceType: 1
              }
            ],
            author: 'user',
            inputMethod: 'Keyboard',
            text: message,
            messageType,
            userIpAddress: await generateRandomIP(),
            timestamp: currentDate
            // messageType: 'SearchQuery'
          },
          tone: 'Creative',
          conversationSignature,
          participant: {
            id: clientId
          },
          spokenTextMode: 'None',
          conversationId,
          previousMessages: pm
        }
      ],
      invocationId: invocationId.toString(),
      target: 'chat',
      type: 4
    }
    // simulates document summary function on Edge's Bing sidebar
    // unknown character limit, at least up to 7k
    if (exceedConversations.length > 0) {
      context += '\nThese are some conversations records between you and I: \n'
      context += exceedConversations.map(m => {
        return `${m.author}: ${m.text}`
      }).join('\n')
      context += '\n'
    }
    if (context) {
      obj.arguments[0].previousMessages.push({
        author: 'user',
        description: context,
        contextType: 'WebPage',
        messageType: 'Context',
        messageId: 'discover-web--page-ping-mriduna-----'
      })
    }
    if (obj.arguments[0].previousMessages.length === 0) {
      delete obj.arguments[0].previousMessages
    }
    let apology = false
    const messagePromise = new Promise((resolve, reject) => {
      let replySoFar = ['']
      let adaptiveCardsSoFar = null
      let suggestedResponsesSoFar = null
      let stopTokenFound = false

      const messageTimeout = setTimeout(() => {
        this.cleanupWebSocketConnection(ws)
        if (replySoFar[0]) {
          let message = {
            adaptiveCards: adaptiveCardsSoFar,
            text: replySoFar.join('')
          }
          resolve({
            message
          })
        } else {
          reject(new Error('Timed out waiting for response. Try enabling debug mode to see more information.'))
        }
      }, timeout)
      const firstTimeout = setTimeout(() => {
        if (!replySoFar[0]) {
          this.cleanupWebSocketConnection(ws)
          reject(new Error('等待必应服务器响应超时。请尝试调整超时时间配置或减少设定量以避免此问题。'))
        }
      }, firstMessageTimeout)

      // abort the request if the abort controller is aborted
      abortController.signal.addEventListener('abort', () => {
        clearTimeout(messageTimeout)
        clearTimeout(firstTimeout)
        this.cleanupWebSocketConnection(ws)
        if (replySoFar[0]) {
          let message = {
            adaptiveCards: adaptiveCardsSoFar,
            text: replySoFar.join('')
          }
          resolve({
            message
          })
        } else {
          reject('Request aborted')
        }
      })
      let cursor = 0
      // let apology = false
      ws.on('message', (data) => {
        const objects = data.toString().split('')
        const events = objects.map((object) => {
          try {
            return JSON.parse(object)
          } catch (error) {
            return object
          }
        }).filter(message => message)
        // console.log(events)
        if (events.length === 0) {
          return
        }
        const eventFiltered = events.filter(e => e.type === 1 || e.type === 2)
        if (eventFiltered.length === 0) {
          return
        }
        const event = eventFiltered[0]
        switch (event.type) {
          case 1: {
            // reject(new Error('test'))
            if (stopTokenFound || apology) {
              return
            }
            const messages = event?.arguments?.[0]?.messages
            if (!messages?.length || messages[0].author !== 'bot') {
              if (event?.arguments?.[0]?.throttling?.maxNumUserMessagesInConversation) {
                global.maxNumUserMessagesInConversation = event?.arguments?.[0]?.throttling?.maxNumUserMessagesInConversation
              }
              return
            }
            const message = messages.length
              ? messages[messages.length - 1]
              : {
                  adaptiveCards: adaptiveCardsSoFar,
                  text: replySoFar.join('')
                }

            if (messages[0].contentOrigin === 'Apology') {
              console.log('Apology found')
              if (!replySoFar[0]) {
                apology = true
              }
              stopTokenFound = true
              clearTimeout(messageTimeout)
              clearTimeout(firstTimeout)
              this.cleanupWebSocketConnection(ws)
              // adaptiveCardsSoFar || (message.adaptiveCards[0].body[0].text = replySoFar)
              console.log({ replySoFar, message })
              message.adaptiveCards = adaptiveCardsSoFar
              message.text = replySoFar.join('') || message.spokenText
              message.suggestedResponses = suggestedResponsesSoFar
              // 遇到Apology不发送默认建议回复
              // message.suggestedResponses = suggestedResponsesSoFar || message.suggestedResponses
              resolve({
                message,
                conversationExpiryTime: event?.item?.conversationExpiryTime
              })
              return
            } else {
              adaptiveCardsSoFar = message.adaptiveCards
              suggestedResponsesSoFar = message.suggestedResponses
            }
            const updatedText = messages[0].text
            console.log(JSON.stringify(messages))
            if (!updatedText || updatedText === replySoFar[cursor]) {
              return
            }
            let difference
            // get the difference between the current text and the previous text
            if (replySoFar[cursor] && updatedText.startsWith(replySoFar[cursor])) {
              difference = updatedText.replace(replySoFar[cursor], '')
              replySoFar[cursor] = updatedText
            } else if (replySoFar[cursor]) {
              cursor += 1
              difference = updatedText
              replySoFar.push(updatedText)
            } else {
              replySoFar[cursor] = updatedText
              difference = updatedText
            }
            onProgress(difference)
            return
          }
          case 2: {
            if (apology) {
              return
            }
            clearTimeout(messageTimeout)
            clearTimeout(firstTimeout)
            this.cleanupWebSocketConnection(ws)
            if (event.item?.result?.value === 'InvalidSession') {
              reject(`${event.item.result.value}: ${event.item.result.message}`)
              return
            }
            let messages = event.item?.messages || []
            // messages = messages.filter(m => m.author === 'bot')
            const message = messages.length
              ? messages[messages.length - 1]
              : {
                  adaptiveCards: adaptiveCardsSoFar,
                  text: replySoFar.join('')
                }
            // 获取到图片内容
            if (message.contentType === 'IMAGE') {
              message.imageTag = messages.filter(m => m.contentType === 'IMAGE').map(m => m.text).join('')
            }
            message.text = messages.filter(m => m.author === 'bot' && m.contentType != 'IMAGE').map(m => m.text).join('')
            if (!message) {
              reject('No message was generated.')
              return
            }
            if (message?.author !== 'bot') {
              if (event.item?.result) {
                if (event.item?.result?.exception?.indexOf('maximum context length') > -1) {
                  reject('对话长度太长啦！超出8193token，请结束对话重新开始')
                } else if (event.item?.result.value === 'Throttled') {
                  reject('该账户的SERP请求已被限流')
                  console.warn('该账户的SERP请求已被限流')
                  console.warn(JSON.stringify(event.item?.result))
                } else {
                  reject(`${event.item?.result.value}\n${event.item?.result.error}\n${event.item?.result.exception}`)
                }
              } else {
                reject('Unexpected message author.')
              }

              return
            }
            if (message.contentOrigin === 'Apology') {
              if (!replySoFar[0]) {
                apology = true
              }
              console.log('Apology found')
              stopTokenFound = true
              clearTimeout(messageTimeout)
              clearTimeout(firstTimeout)
              this.cleanupWebSocketConnection(ws)
              // message.adaptiveCards[0].body[0].text = replySoFar || message.spokenText
              message.adaptiveCards = adaptiveCardsSoFar
              message.text = replySoFar.join('') || message.spokenText
              message.suggestedResponses = suggestedResponsesSoFar
              // 遇到Apology不发送默认建议回复
              // message.suggestedResponses = suggestedResponsesSoFar || message.suggestedResponses
              resolve({
                message,
                conversationExpiryTime: event?.item?.conversationExpiryTime
              })
              return
            }
            if (event.item?.result?.error) {
              if (this.debug) {
                console.debug(event.item.result.value, event.item.result.message)
                console.debug(event.item.result.error)
                console.debug(event.item.result.exception)
              }
              if (replySoFar[0]) {
                message.text = replySoFar.join('')
                resolve({
                  message,
                  conversationExpiryTime: event?.item?.conversationExpiryTime
                })
                return
              }
              reject(`${event.item.result.value}: ${event.item.result.message}`)
              return
            }
            // The moderation filter triggered, so just return the text we have so far
            if (stopTokenFound || event.item.messages[0].topicChangerText) {
              // message.adaptiveCards[0].body[0].text = replySoFar
              message.adaptiveCards = adaptiveCardsSoFar
              message.text = replySoFar.join('')
            }
            resolve({
              message,
              conversationExpiryTime: event?.item?.conversationExpiryTime
            })
          }
          default:
        }
      })
      ws.on('error', err => {
        reject(err)
      })
    })

    const messageJson = JSON.stringify(obj)
    if (this.debug) {
      console.debug(messageJson)
      console.debug('\n\n\n\n')
    }
    try {
      ws.send(`${messageJson}`)
      const {
        message: reply,
        conversationExpiryTime
      } = await messagePromise
      const replyMessage = {
        id: crypto.randomUUID(),
        parentMessageId: userMessage.id,
        role: 'Bing',
        message: reply.text,
        details: reply
      }

      return {
        conversationSignature,
        conversationId,
        clientId,
        invocationId: invocationId + 1,
        messageId: replyMessage.id,
        conversationExpiryTime,
        response: reply.text,
        details: reply,
        apology: apology
      }
    } catch (err) {
      throw err
    }
  }

}

async function generateRandomIP () {
  const baseIP = '104.28.215.'
  const subnetSize = 254 // 2^8 - 2
  const randomIPSuffix = Math.floor(Math.random() * subnetSize) + 1
  let ip = baseIP + randomIPSuffix
  return ip
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

module.exports = {
  SydneyAIClient
}