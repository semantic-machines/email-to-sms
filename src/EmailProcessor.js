import ExchangeClient from './ExchangeClient.js';
import SMSClient from './SMSClient.js';
import log from './log.js';
import {timeout} from './Util.js';

export default class EmailProcessor {
  static #instance;

  constructor (options) {
    if (EmailProcessor.#instance) return EmailProcessor.#instance;
    EmailProcessor.#instance = this;

    this.options = options;
    this.exchangeClient = new ExchangeClient(options.exchange);
    this.smsClient = new SMSClient(options.sms);
    this.stopSignal = false;
  }

  async init () {
    this.exchangeClient.init();
  }

  stop () {
    this.stopSignal = true;
    if (this._stopPromiseResolve) {
      this._stopPromiseResolve();
    }
  }

  async run () {
    const re = /^\d{11}$/;

    while (!this.stopSignal) {
      const emails = await this.exchangeClient.getEmails(this.options.exchange.batchSize);

      for (const email of emails) {
        const message = email.TextBody?.text;
        const tels = email.Subject?.replaceAll(/[\+\-\s\t\n\(\)]/g, '').split(';').filter(Boolean).filter(re.test.bind(re));
        if (!tels || !tels.length || !message) {
          log.info('Email message skipped as malformed. Subject:', email.Subject, 'Body:', email.TextBody.text);
          await this.exchangeClient.markAsRead(email);
          continue;
        }
        for (const tel of tels) {
          await this.smsClient.sendMessage(tel, message);
          log.info(`SMS sent successfully. Tel: ${tel}, message: ${message}`);
        }
        await this.exchangeClient.deleteEmail(email);
      }

      log.debug('Processed emails:', emails.length);

      // Continue processing as there are possibly more emails available
      if (emails.length === this.options.exchange.batchSize) continue;

      await Promise.race([
        timeout(this.options.timeout),
        new Promise((resolve) => {
          this._stopPromiseResolve = resolve;
        }),
      ]);
    }
  }
}
