import log from './log.js';

export default class SMSClient {
  static #instance;

  constructor (options) {
    if (SMSClient.#instance) return SMSClient.#instance;
    SMSClient.#instance = this;

    this.options = options;
  }

  async sendMessage (tel, message) {
    try {
      const payload = {
        'from': this.options.from,
        'to': parseInt(tel),
        'message': message,
      };

      const response = await fetch(this.options.server, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Basic ' + btoa(this.options.user + ':' + this.options.password),
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const status = response.status;
        const text = await response.text();
        throw new Error(`Status: ${status}, text: ${text}`);
      }
    } catch (error) {
      log.error('SMS send error:', error.message);
      log.debug(error);
      throw error;
    }
  }
}
