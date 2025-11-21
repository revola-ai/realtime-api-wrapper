import { RealtimeEventHandler } from './event_handler.js';
import { RealtimeUtils } from './utils.js';

export class RealtimeAPI extends RealtimeEventHandler {
  /**
   * Create a new RealtimeAPI instance
   * @param {{url?: string, apiKey?: string, dangerouslyAllowAPIKeyInBrowser?: boolean, debug?: boolean}} [settings]
   * @returns {RealtimeAPI}
   */
  constructor({ url, apiKey, dangerouslyAllowAPIKeyInBrowser, debug } = {}) {
    super();
    this.defaultUrl = 'wss://api.openai.com/v1/realtime?model=gpt-realtime-mini';
    this.url = url || this.defaultUrl;
    this.apiKey = apiKey || null;
    this.debug = !!debug;
    this.ws = null;
    if (globalThis.document && this.apiKey) {
      if (!dangerouslyAllowAPIKeyInBrowser) {
        throw new Error(
          `Can not provide API key in the browser without "dangerouslyAllowAPIKeyInBrowser" set to true`,
        );
      }
    }
  }

  /**
   * Tells us whether or not the WebSocket is connected
   * @returns {boolean}
   */
  isConnected() {
    return !!this.ws;
  }

  /**
   * Writes WebSocket logs to console
   * @param  {...any} args
   * @returns {true}
   */
  log(...args) {
    const date = new Date().toISOString();
    const logs = [`[Websocket/${date}]`].concat(args).map((arg) => {
      if (typeof arg === 'object' && arg !== null) {
        return JSON.stringify(arg, null, 2);
      } else {
        return arg;
      }
    });
    if (this.debug) {
      console.log(...logs);
    }
    return true;
  }

  /**
   * Connects to Realtime API Websocket Server
   * @param {{model?: string}} [settings]
   * @returns {Promise<true>}
   */
  async connect() {
    if (!this.apiKey && this.url === this.defaultUrl) {
      console.warn(`No apiKey provided for connection to "${this.url}"`);
    }
    this.log(`URL: "${this.url}"`);
    if (this.isConnected()) {
      throw new Error(`Already connected`);
    }

    let protocols = []; 
    if (globalThis.WebSocket) {
      /**
       * Web browser
       */
      if (globalThis.document && this.apiKey) {
        console.warn(
          'Warning: Connecting using API key in the browser, this is not recommended',
        );
      }
      const WebSocket = globalThis.WebSocket;
      this.log('Connecting to URL with default (empty) protocols:', this.url);

      if (this.url.startsWith('wss://api.openai.com')) {
        // If so, use the special OpenAI protocols
        this.log('URL is an official OpenAI endpoint. Adding specific protocols.');
        protocols = [
          'realtime',
          `openai-insecure-api-key.${this.apiKey}`,
          'openai-beta.realtime-v1',
        ];
      }
      const ws = new WebSocket(this.url, protocols);
      ws.addEventListener('message', (event) => {
        const message = JSON.parse(event.data);
        this.receive(message.type, message);
      });
      return new Promise((resolve, reject) => {
        const connectionErrorHandler = () => {
          this.disconnect(ws);
          reject(new Error(`Could not connect to "${this.url}"`));
        };
        ws.addEventListener('error', connectionErrorHandler);
        ws.addEventListener('open', () => {
          this.log(`Connected to "${this.url}"`);
          ws.removeEventListener('error', connectionErrorHandler);
          ws.addEventListener('error', () => {
            this.disconnect(ws);
            this.log(`Error, disconnected from "${this.url}"`);
            this.dispatch('close', { error: true });
          });
          ws.addEventListener('close', () => {
            this.disconnect(ws);
            this.log(`Disconnected from "${this.url}"`);
            this.dispatch('close', { error: false });
          });
          this.ws = ws;

          this.dispatch('connect');
          
          resolve(true);
        });
      });
    } else {
      /**
       * Node.js
       */
      const moduleName = 'ws';
      const wsModule = await import(/* webpackIgnore: true */ moduleName);
      const WebSocket = wsModule.default;
      const ws = new WebSocket(
        this.url,
        protocols,
        {
          finishRequest: (request) => {
            request.setHeader('Authorization', `Bearer ${this.apiKey}`);
            request.setHeader('OpenAI-Beta', 'realtime=v1');
            request.end();
          },
        },
      );
      ws.on('message', (data) => {
        const message = JSON.parse(data.toString());
        this.receive(message.type, message);
      });
      return new Promise((resolve, reject) => {
        const connectionErrorHandler = () => {
          this.disconnect(ws);
          reject(new Error(`Could not connect to "${this.url}"`));
        };
        ws.on('error', connectionErrorHandler);
        ws.on('open', () => {
          this.log(`Connected to "${this.url}"`);
          ws.removeListener('error', connectionErrorHandler);
          ws.on('error', () => {
            this.disconnect(ws);
            this.log(`Error, disconnected from "${this.url}"`);
            this.dispatch('close', { error: true });
          });
          ws.on('close', () => {
            this.disconnect(ws);
            this.log(`Disconnected from "${this.url}"`);
            this.dispatch('close', { error: false });
          });
          this.ws = ws;
          resolve(true);
        });
      });
    }
  }

  /**
   * Disconnects from Realtime API server
   * @param {WebSocket} [ws]
   * @returns {true}
   */
  disconnect(ws) {
    if (!ws || this.ws === ws) {
      this.ws && this.ws.close();
      this.ws = null;
      return true;
    }
  }

  /**
   * Receives an event from WebSocket and dispatches as "server.{eventName}" and "server.*" events
   * @param {string} eventName
   * @param {{[key: string]: any}} event
   * @returns {true}
   */
  receive(eventName, event) {
    // Filter out high-frequency audio events from logging (both beta and GA names)
    const isAudioDelta = eventName === "response.audio.delta" ||
                         eventName === "response.output_audio.delta" ||
                         eventName === "response.audio_transcript.delta" ||
                         eventName === "response.output_audio_transcript.delta";

    if (!isAudioDelta) {
      this.log(`received:`, eventName, event);
    }
    this.dispatch(`server.${eventName}`, event);
    this.dispatch('server.*', event);
    return true;
  }

  /**
   * Sends an event to WebSocket and dispatches as "client.{eventName}" and "client.*" events
   * @param {string} eventName
   * @param {{[key: string]: any}} event
   * @returns {true}
   */
  send(eventName, data) {
    if (!this.isConnected()) {
      throw new Error(`RealtimeAPI is not connected`);
    }
    data = data || {};
    if (typeof data !== 'object') {
      throw new Error(`data must be an object`);
    }
    const event = {
      event_id: RealtimeUtils.generateId('evt_'),
      type: eventName,
      ...data,
    };
    this.dispatch(`client.${eventName}`, event);
    this.dispatch('client.*', event);
    if (eventName != "input_audio_buffer.append") {
      this.log(`sent:`, eventName, event);
    }
    this.ws.send(JSON.stringify(event));
    return true;
  }
}
