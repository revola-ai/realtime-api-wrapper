import { RealtimeUtils } from './utils.js';

/**
 * Contains text and audio information about a item
 * Can also be used as a delta
 * @typedef {Object} ItemContentDeltaType
 * @property {string} [text]
 * @property {Int16Array} [audio]
 * @property {string} [arguments]
 * @property {string} [transcript]
 */

/**
 * RealtimeConversation holds conversation history
 * and performs event validation for RealtimeAPI
 * @class
 */
export class RealtimeConversation {
  defaultFrequency = 24_000; // 24,000 Hz
  audioFormat = 'pcm16'; // Track current audio format

  EventProcessors = {
    'conversation.item.created': (event) => {
      const { item } = event;
      const newItem = JSON.parse(JSON.stringify(item));
      if (!this.itemLookup[newItem.id]) {
        this.itemLookup[newItem.id] = newItem;
        this.items.push(newItem);
      }
      newItem.formatted = {};
      newItem.formatted.audio = new Int16Array(0);
      newItem.formatted.text = '';
      newItem.formatted.transcript = '';
      if (this.queuedSpeechItems[newItem.id]) {
        if (this.queuedSpeechItems[newItem.id].audio) {
          newItem.formatted.audio = this.queuedSpeechItems[newItem.id].audio;
        }
        delete this.queuedSpeechItems[newItem.id];
      }
      if (newItem.content) {
        const textContent = newItem.content.filter((c) =>
          ['text', 'input_text', 'output_text'].includes(c.type),
        );
        for (const content of textContent) {
          newItem.formatted.text += content.text;
        }
        // Handle audio content (both beta 'audio' and GA 'output_audio')
        const audioContent = newItem.content.filter((c) =>
          ['audio', 'output_audio', 'input_audio'].includes(c.type),
        );
        for (const content of audioContent) {
          if (content.audio) {
            const arrayBuffer = RealtimeUtils.base64ToArrayBuffer(content.audio);
            const audioData = new Int16Array(arrayBuffer);
            newItem.formatted.audio = RealtimeUtils.mergeInt16Arrays(
              newItem.formatted.audio,
              audioData,
            );
          }
        }
      }
      if (this.queuedTranscriptItems[newItem.id]) {
        newItem.formatted.transcript = this.queuedTranscriptItems[newItem.id].transcript;
        delete this.queuedTranscriptItems[newItem.id];
      }
      if (newItem.type === 'message') {
        if (newItem.role === 'user') {
          newItem.status = 'completed';
          if (this.queuedInputAudio) {
            newItem.formatted.audio = this.queuedInputAudio;
            this.queuedInputAudio = null;
          }
        } else {
          newItem.status = 'in_progress';
        }
      } else if (newItem.type === 'function_call') {
        newItem.formatted.tool = {
          type: 'function',
          name: newItem.name,
          call_id: newItem.call_id,
          arguments: '',
        };
        if (this.queuedTranscriptItems[newItem.id] && this.queuedTranscriptItems[newItem.id].arguments) {
            newItem.formatted.tool.arguments = this.queuedTranscriptItems[newItem.id].arguments;
            newItem.arguments = this.queuedTranscriptItems[newItem.id].arguments;
            delete this.queuedTranscriptItems[newItem.id];
        }
        newItem.status = 'in_progress';
      } else if (newItem.type === 'function_call_output') {
        newItem.status = 'completed';
        newItem.formatted.output = newItem.output;
      }
      return { item: newItem, delta: null };
    },
    'conversation.item.added': (event) => {
      // GA API: Same as item.created, use the same handler
      return this.EventProcessors['conversation.item.created'].call(this, event);
    },
    'conversation.item.done': (event) => {
      // GA API: Item is complete, ensure status is updated
      const { item } = event;
      const existingItem = this.itemLookup[item.id];
      if (existingItem) {
        // Update with final item state
        Object.assign(existingItem, item);
        return { item: existingItem, delta: null };
      }
      // If item doesn't exist yet, process it as a new item
      return this.EventProcessors['conversation.item.created'].call(this, event);
    },
    'conversation.item.truncated': (event) => {
      const { item_id, audio_end_ms } = event;
      const item = this.itemLookup[item_id];
      if (!item) {
        console.warn(`[RealtimeConversation] item.truncated: Item "${item_id}" not found. Ignoring event.`);
        return { item: null, delta: null };
      }
      const endIndex = Math.floor(
        (audio_end_ms * this.defaultFrequency) / 1000,
      );
      item.formatted.transcript = '';
      item.formatted.audio = item.formatted.audio.slice(0, endIndex);
      return { item, delta: null };
    },
    'conversation.item.deleted': (event) => {
      const { item_id } = event;
      const item = this.itemLookup[item_id];
      if (!item) {
        console.warn(`[RealtimeConversation] item.deleted: Item "${item_id}" not found. Ignoring event.`);
        return { item: null, delta: null };
      }
      delete this.itemLookup[item.id];
      const index = this.items.indexOf(item);
      if (index > -1) {
        this.items.splice(index, 1);
      }
      return { item, delta: null };
    },
    'conversation.item.input_audio_transcription.completed': (event) => {
      const { item_id, content_index, transcript } = event;
      const item = this.itemLookup[item_id];
      const formattedTranscript = transcript || ' ';
      if (!item) {
        this.queuedTranscriptItems[item_id] = {
          transcript: formattedTranscript,
        };
        return { item: null, delta: null };
      } else {
        item.content[content_index].transcript = transcript;
        item.formatted.transcript = formattedTranscript;
        return { item, delta: { transcript } };
      }
    },
    'input_audio_buffer.speech_started': (event) => {
      const { item_id, audio_start_ms } = event;
      this.queuedSpeechItems[item_id] = { audio_start_ms };
      return { item: null, delta: null };
    },
    'input_audio_buffer.speech_stopped': (event, inputAudioBuffer) => {
      const { item_id, audio_end_ms } = event;
      if (!this.queuedSpeechItems[item_id]) {
        this.queuedSpeechItems[item_id] = { audio_start_ms: audio_end_ms };
      }
      const speech = this.queuedSpeechItems[item_id];
      speech.audio_end_ms = audio_end_ms;
      if (inputAudioBuffer) {
        const startIndex = Math.floor(
          (speech.audio_start_ms * this.defaultFrequency) / 1000,
        );
        const endIndex = Math.floor(
          (speech.audio_end_ms * this.defaultFrequency) / 1000,
        );
        speech.audio = inputAudioBuffer.slice(startIndex, endIndex);
      }
      return { item: null, delta: null };
    },
    'response.created': (event) => {
      const { response } = event;
      if (!this.responseLookup[response.id]) {
        this.responseLookup[response.id] = response;
        this.responses.push(response);
      }
      return { item: null, delta: null };
    },
    'response.output_item.added': (event) => {
      const { response_id, item } = event;
      const response = this.responseLookup[response_id];
      if (!response) {
        console.warn(`[RealtimeConversation] response.output_item.added: Response "${response_id}" not found. Ignoring event.`);
        return { item: null, delta: null };
      }

      // Add item to lookup and items list (required for audio deltas to find the item)
      const newItem = JSON.parse(JSON.stringify(item));
      if (!this.itemLookup[newItem.id]) {
        this.itemLookup[newItem.id] = newItem;
        this.items.push(newItem);
      }

      // Initialize formatted object for audio/text/transcript deltas
      newItem.formatted = {
        audio: new Int16Array(0),
        text: '',
        transcript: ''
      };

      // Add item to response output
      response.output.push(item.id);

      return { item: newItem, delta: null };
    },
    'response.output_item.done': (event) => {
      const { item } = event;
      if (!item) {
        console.warn(`[RealtimeConversation] response.output_item.done: Missing "item". Ignoring event.`);
        return { item: null, delta: null };
      }
      const foundItem = this.itemLookup[item.id];
      if (!foundItem) {
        console.warn(`[RealtimeConversation] response.output_item.done: Item "${item.id}" not found. Ignoring event.`);
        return { item: null, delta: null };
      }
      foundItem.status = item.status;
      return { item: foundItem, delta: null };
    },
    'response.content_part.added': (event) => {
      const { item_id, part } = event;
      const item = this.itemLookup[item_id];
      if (!item) {
        console.warn(`[RealtimeConversation] response.content_part.added: Item "${item_id}" not found. Ignoring event.`);
        return { item: null, delta: null };
      }
      item.content.push(part);
      return { item, delta: null };
    },
    'response.audio_transcript.delta': (event) => {
      const { item_id, content_index, delta } = event;
      const item = this.itemLookup[item_id];
      if (!item) {
        if (!this.queuedTranscriptItems[item_id]) {
            this.queuedTranscriptItems[item_id] = { transcript: '' };
        }
        this.queuedTranscriptItems[item_id].transcript += delta;
        return { item: null, delta: null };
      }
      if (item.content[content_index] && item.content[content_index].transcript === undefined) {
        item.content[content_index].transcript = '';
      }
      item.content[content_index].transcript += delta;
      item.formatted.transcript += delta;
      return { item, delta: { transcript: delta } };
    },
    'response.output_audio_transcript.delta': (event) => {
      const { item_id, content_index, delta } = event;
      const item = this.itemLookup[item_id];
      if (!item) {
        if (!this.queuedTranscriptItems[item_id]) {
            this.queuedTranscriptItems[item_id] = { transcript: '' };
        }
        this.queuedTranscriptItems[item_id].transcript += delta;
        return { item: null, delta: null };
      }
      if (item.content[content_index] && item.content[content_index].transcript === undefined) {
        item.content[content_index].transcript = '';
      }
      item.content[content_index].transcript += delta;
      item.formatted.transcript += delta;
      return { item, delta: { transcript: delta } };
    },
    'response.audio.delta': (event) => {
      const { item_id, content_index, delta } = event;
      const item = this.itemLookup[item_id];
      if (!item) {
        if (!this.queuedSpeechItems[item_id]) {
            this.queuedSpeechItems[item_id] = { audio: new Int16Array(0) };
        }
        const arrayBuffer = RealtimeUtils.base64ToArrayBuffer(delta);
        const appendValues = new Int16Array(arrayBuffer);
        this.queuedSpeechItems[item_id].audio = RealtimeUtils.mergeInt16Arrays(
            this.queuedSpeechItems[item_id].audio,
            appendValues,
        );
        return { item: null, delta: null };
      }
      const arrayBuffer = RealtimeUtils.base64ToArrayBuffer(delta);
      const appendValues = new Int16Array(arrayBuffer);
      item.formatted.audio = RealtimeUtils.mergeInt16Arrays(
        item.formatted.audio,
        appendValues,
      );
      return { item, delta: { audio: appendValues } };
    },
    'response.output_audio.delta': (event) => {
      const { item_id, content_index, delta } = event;
      const item = this.itemLookup[item_id];
      if (!item) {
        if (!this.queuedSpeechItems[item_id]) {
            this.queuedSpeechItems[item_id] = { audio: new Int16Array(0) };
        }
        const arrayBuffer = RealtimeUtils.base64ToArrayBuffer(delta);
        const appendValues = new Int16Array(arrayBuffer);
        this.queuedSpeechItems[item_id].audio = RealtimeUtils.mergeInt16Arrays(
            this.queuedSpeechItems[item_id].audio,
            appendValues,
        );
        return { item: null, delta: null };
      }
      const arrayBuffer = RealtimeUtils.base64ToArrayBuffer(delta);
      const appendValues = new Int16Array(arrayBuffer);
      item.formatted.audio = RealtimeUtils.mergeInt16Arrays(
        item.formatted.audio,
        appendValues,
      );
      return { item, delta: { audio: appendValues } };
    },
    'response.text.delta': (event) => {
      const { item_id, content_index, delta } = event;
      const item = this.itemLookup[item_id];
      if (!item) {
        if (!this.queuedTranscriptItems[item_id]) {
            this.queuedTranscriptItems[item_id] = { transcript: '' };
        }
        this.queuedTranscriptItems[item_id].transcript += delta;
        return { item: null, delta: null };
      }
      if (item.content[content_index] && item.content[content_index].text === undefined) {
          item.content[content_index].text = '';
      }
      item.content[content_index].text += delta;
      item.formatted.text += delta;
      return { item, delta: { text: delta } };
    },
    'response.output_text.delta': (event) => {
      const { item_id, content_index, delta } = event;
      const item = this.itemLookup[item_id];
      if (!item) {
        if (!this.queuedTranscriptItems[item_id]) {
            this.queuedTranscriptItems[item_id] = { transcript: '' };
        }
        this.queuedTranscriptItems[item_id].transcript += delta;
        return { item: null, delta: null };
      }
      if (item.content[content_index] && item.content[content_index].text === undefined) {
          item.content[content_index].text = '';
      }
      item.content[content_index].text += delta;
      item.formatted.text += delta;
      return { item, delta: { text: delta } };
    },
    'response.function_call_arguments.delta': (event) => {
      const { item_id, delta } = event;
      const item = this.itemLookup[item_id];
      if (!item) {
        if (!this.queuedTranscriptItems[item_id]) {
            this.queuedTranscriptItems[item_id] = { arguments: '' };
        }
        this.queuedTranscriptItems[item_id].arguments = (this.queuedTranscriptItems[item_id].arguments || '') + delta;
        return { item: null, delta: null };
      }
      item.arguments += delta;
      item.formatted.tool.arguments += delta;
      return { item, delta: { arguments: delta } };
    },
  };

  /**
   * Create a new RealtimeConversation instance
   * @returns {RealtimeConversation}
   */
  constructor() {
    this.clear();
  }

  /**
   * Sets the audio format for the conversation
   * @param {string} format - The audio format (pcm16, g711_ulaw, g711_alaw)
   * @returns {true}
   */
  setAudioFormat(format) {
    this.audioFormat = format;
    this.defaultFrequency = RealtimeUtils.getSampleRate(format);
    return true;
  }

  /**
   * Clears the conversation history and resets to default
   * @returns {true}
   */
  clear() {
    this.itemLookup = {};
    this.items = [];
    this.responseLookup = {};
    this.responses = [];
    this.queuedSpeechItems = {};
    this.queuedTranscriptItems = {};
    this.queuedInputAudio = null;
    return true;
  }

  /**
   * Queue input audio for manual speech event
   * @param {Int16Array} inputAudio
   * @returns {Int16Array}
   */
  queueInputAudio(inputAudio) {
    this.queuedInputAudio = inputAudio;
    return inputAudio;
  }

  /**
   * Process an event from the WebSocket server and compose items
   * @param {Object} event
   * @param  {...any} args
   * @returns {item: import('./client.js').ItemType | null, delta: ItemContentDeltaType | null}
   */
  processEvent(event, ...args) {
    if (!event.event_id) {
      console.error(event);
      throw new Error(`Missing "event_id" on event`);
    }
    if (!event.type) {
      console.error(event);
      throw new Error(`Missing "type" on event`);
    }
    const eventProcessor = this.EventProcessors[event.type];
    if (!eventProcessor) {
      throw new Error(
        `Missing conversation event processor for "${event.type}"`,
      );
    }
    return eventProcessor.call(this, event, ...args);
  }

  /**
   * Retrieves a item by id
   * @param {string} id
   * @returns {import('./client.js').ItemType}
   */
  getItem(id) {
    return this.itemLookup[id] || null;
  }

  /**
   * Retrieves all items in the conversation
   * @returns {import('./client.js').ItemType[]}
   */
  getItems() {
    return this.items.slice();
  }
}
