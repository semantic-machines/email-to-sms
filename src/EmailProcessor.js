import ExchangeClient from './ExchangeClient.js';
import SMSClient from './SMSClient.js';
import log from './log.js';
import {onlyUnique, timeout} from './Util.js';
import sendTelegram from './sendTelegram.js';

export default class EmailProcessor {
  static #instance;

  constructor (options) {
    if (EmailProcessor.#instance) return EmailProcessor.#instance;
    EmailProcessor.#instance = this;

    this.options = options;
    this.exchangeClient = new ExchangeClient(options.exchange);
    this.smsClient = new SMSClient(options.sms);
    this.stopSignal = false;
    this.subscription = null;

    this.eventsQueue = [];
    this.processedTels = {};
    this.cancelSignals = {};
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

  async prerun () {
    await this.checkInboxFolder();
    await this.checkSubscription();

    setInterval(this.checkSubscription.bind(this), 1 * 60 * 1000);

    setInterval(() => {
      this.checkInboxFolder().catch((error) => {
        log.error(`Error while checking inbox folder: ${error.message}`);
        log.debug(error);
      });
    }, 1 * 60 * 1000);
  }

  async run () {
    await this.prerun();

    while (!this.stopSignal) {
      while (this.eventsQueue.length != 0) {
        const event = this.eventsQueue.shift();
        try {
          await this.handleEvent(event);
        } catch (error) {
          log.error(`Error while processing event-type: ${event.type}\nError: ${error.message}`);
          log.debug(error);
          throw error;
        }
      }
      await timeout(1000);
    }
    this.closeSubscription();
  }

  async checkInboxFolder () {
    if (this.subscription && this.subscription.IsOpen) {
      return;
    }
    const batchSize = this.options.exchange.batchSize || 10;
    const emails = await this.exchangeClient.getAllNewEmails(batchSize);
    const result = emails.map((email) => ({itemId: email.Id}));
    await this.handleNotificationEvent(null, {Events: result});
  }

  async handleEvent (event) {
    const {type, email, message, notificationType} = event;
    if (type == 'default') {
      this.handleDefaultEmail(email);
    } else if (type == 'dispetcher_warning') {
      const processedTelsArr = await this.handleAlertEmail(email, message, notificationType);
      this.processedTels[event.notificationType] = processedTelsArr;
    } else if (type == 'dispetcher_warning_cancel') {
      await this.handleCancelEmail(email, message, notificationType);
    }
  }

  async handleNotificationEvent (sender, args) {
    for (const event of args.Events) {
      const id = event.itemId;
      const email = await this.exchangeClient.downloadEmail(id);
      if (!email.From) return;
      if (this.options.dispetcherEmails.some((e) => email.From.address == e)) {
        await this.handleDispetcherEvent(email);
      } else {
        try {
          log.info(`Default event received. From: ${email.From.address}`);
          //log.info(`Sender: ${JSON.stringify(email.Sender)}`);
        } catch (error) {
          log.debug(error);
        }
        this.eventsQueue.push({type: 'default', email});
      }
    }
  }

  async handleDispetcherEvent (email) {
    const {alertType, notificationType, message} = this.parseEmailSubject(email.Subject);
    if (alertType.includes('GOALERT')) {
      log.info(`Dispetcher warning event received. Alert type: ${alertType}, Notification type: ${notificationType}, message: ${message}`);
      this.processDispetcherWarning(email, notificationType, message);
    } else if (alertType.includes('STOPALERT')) {
      log.info(`Dispetcher warning cancel event received. Alert type: ${alertType}, Notification type: ${notificationType}, message: ${message}`);
      this.processDispetcherWarningCancel(email, notificationType, message);
    } else {
      log.info(`Unknown dispetcher event received. Alert type: ${alertType}, Notification type: ${notificationType}, message: ${message}`);
      await this.handleUnknownDispetcherEvent(email);
    }
  }

  parseEmailSubject (subject) {
    const [eventType, message] = subject.split('|').map((part) => part.trim());
    const [alertType, notificationType] = eventType.split('-').map((part) => part.trim());
    return {alertType, notificationType: notificationType || 'default', message};
  }

  processDispetcherWarning (email, notificationType, message) {
    //log.info('Dispetcher warning event received');
    this.eventsQueue.unshift({type: 'dispetcher_warning', email, notificationType, message});
  }

  processDispetcherWarningCancel (email, notificationType, message) {
    //log.info('Dispetcher warning cancel event received');
    this.cancelSignals[notificationType] = true;
    const index = this.eventsQueue.findIndex((event) => event.type !== 'dispetcher_warning');
    const event = {type: 'dispetcher_warning_cancel', email, notificationType, message};

    if (index === -1) {
      this.eventsQueue.unshift(event);
    } else {
      this.eventsQueue.splice(index, 0, event);
    }
  }

  async handleUnknownDispetcherEvent (email) {
    log.warn('Unknown dispetcher event received');
    await this.exchangeClient.replyEmail(email, 'Тема сообщения не предусмотрена!');
    await this.exchangeClient.deleteEmail(email);
  }

  async handleDefaultEmail (email) {
    const text = email.From.address.toLowerCase() == 'syk-sms@slpk.com' ? `PIMS: ${email.TextBody?.text}` : email.TextBody?.text;
    const message = text.substring(0, this.options.sms.messageSizeLimit);
    const tels = this.extractTels(email.Subject);
    if (!tels.length || !message) {
      log.info('Email message skipped as malformed. Subject:', email.Subject, 'Body:', email.TextBody.text);
      await this.exchangeClient.markAsRead(email);
      return;
    }
    await this.sendSmsWithRetry(tels, message, this.options.timeout);
    await this.exchangeClient.markAsRead(email);
    await this.exchangeClient.deleteEmail(email);
  }

  async handleAlertEmail (email, message, notificationType) {
    const text = email.TextBody.text || '';
    let tels = this.extractTels(text);
    tels = [
      ...tels,
      ...await this.getTelsFromAttachments(email),
    ].filter(onlyUnique);

    if (!tels.length || !message) {
      await this._handleMalformedEmail(email);
      return [];
    }

    if (this.cancelSignals[notificationType]) {
      await this._handleCancelledEmail(email);
      return [];
    }

    await this.exchangeClient.replyEmail(email, 'Рассылка начата');
    log.info('Начата обработка');
    const processedTelsObj = await this.sendSmsWithResultData(tels, message, this.options.timeoutForDispetcher, notificationType);
    log.info(`Processed tels: ${JSON.stringify(processedTelsObj)}`);
    log.info('Закончена обработка');
    const fileName = await this.writeResultFile(`ALERT_${notificationType}`, processedTelsObj);
    await this._handleEmailCompletion(email, tels, processedTelsObj, fileName);
    return Object.keys(processedTelsObj);
  }

  async _handleMalformedEmail (email) {
    log.info('Email message skipped as malformed. Subject:', email.Subject, 'Body:', email.TextBody.text);
    await this.exchangeClient.replyEmail(email, 'Неверный формат сообщения');
  }

  async _handleCancelledEmail (email) {
    await this.exchangeClient.replyEmail(email, 'Отбой, рассылка отменена');
    await this.exchangeClient.deleteEmail(email);
  }

  async _handleEmailCompletion (email, tels, processedTelsObj, fileName) {
    const successSend = Object.values(processedTelsObj).filter((value) => value === 'OK').length;
    const messagePart = `обработано ${Object.keys(processedTelsObj).length} номеров, выслано ${successSend} СМС`;
    if (tels.length !== Object.keys(processedTelsObj).length) {
      await this.exchangeClient.replyEmail(email, `Отбой, рассылка выполнена частично, ${messagePart}. Высылаю оповещения об отмене!`, fileName);
    } else {
      await this.exchangeClient.replyEmail(email, `Рассылка завершена, ${messagePart}.`, fileName);
    }
    await this.exchangeClient.deleteEmail(email);
  }

  async handleCancelEmail (email, message, notificationType) {
    if (!this.processedTels[notificationType] || !this.processedTels[notificationType].length) {
      log.info(`No processed tels for cancel warning with notification type: ${notificationType}`);
      await this.exchangeClient.replyEmail(email, 'Нет рассылок для отмены');
      await this.exchangeClient.deleteEmail(email);
    } else {
      const tels = this.processedTels[notificationType].filter(onlyUnique);
      await this.exchangeClient.replyEmail(email, `Отбой, высылаю ${tels.length} СМС об отбое`);
      const processedTelsObj = await this.sendSmsWithResultData(tels, message, this.options.timeoutForDispetcher);
      const fileName = await this.writeResultFile(`CANCEL_${notificationType}`, processedTelsObj);
      const successSend = Object.values(processedTelsObj).filter((value) => value === 'OK').length;
      const messagePart = `Обработано ${Object.keys(processedTelsObj).length} номеров, выслано ${successSend} оповещений об отбое`;
      await this.exchangeClient.replyEmail(email, messagePart, fileName);
      await this.exchangeClient.deleteEmail(email);
    }
    delete this.processedTels[notificationType];
    delete this.cancelSignals[notificationType];
  }

  async sendSmsWithRetry (tels, message, timeoutMs = 1000, notificationType) {
    const processedTels = [];
    for (const tel of tels) {
      if (this.shouldCancel(notificationType)) return processedTels;
      await this.trySendSms(tel, message, timeoutMs, processedTels);
    }
    return processedTels;
  }

  async sendSmsWithResultData (tels, message, timeoutMs = 1000, notificationType) {
    const processedTels = {};
    for (const tel of tels) {
      if (this.shouldCancel(notificationType)) return processedTels;
      const resultMessage = await this.trySendSms(tel, message, timeoutMs);
      processedTels[tel] = resultMessage;
      await timeout(timeoutMs);
    }
    return processedTels;
  }

  async writeResultFile (notificationType, resultObject) {
    const fileName = `sendResults/${notificationType}_${new Date().toISOString()}.csv`;
    const fs = await import('fs/promises');
    
    // Создаем заголовок CSV файла
    const csvHeader = 'Телефон,Результат\n';
    
    // Создаем строки данных
    const csvRows = Object.entries(resultObject)
      .map(([tel, result]) => `${tel},${result}`)
      .join('\n');
    
    // Объединяем заголовок и данные
    const csvContent = csvHeader + csvRows;
    
    try {
      // Убеждаемся, что папка sendResult существует
      await fs.mkdir('sendResults', { recursive: true });
      await fs.writeFile(fileName, csvContent, 'utf8');
      log.info(`Результаты сохранены в файл: ${fileName}`);
      return fileName;
    } catch (error) {
      log.error(`Ошибка при записи файла ${fileName}:`, error.message);
      throw error;
    }
  }

  shouldCancel (notificationType) {
    return notificationType && this.cancelSignals[notificationType];
  }

  async trySendSms (tel, message, timeoutMs) {
    let retries = 0;
    while (true) {
      try {
        await this.processTel(tel, message);
        return 'OK';
      } catch (error) {
        if (error.code === 88) {
          // Ошибка при превышении ограничения по лимиту сообщений в секунду
          // Повторяем попытку после паузы
          await this.handleSendError88(tel, error, timeoutMs);
        } else {
          // Любая другая ошибка
          // Пропускаем телефон и идем дальше
          log.error(`Ошибка при отправке SMS на номер ${tel}:`, error.message);
          return error.message;
        }
      }
    }
  }

  async handleSendError88 (tel, error, timeoutMs) {
    const onErrorTimeout = timeoutMs;
    log.error(`Ошибка при отправке SMS на номер ${tel}:`, error.message);
    log.info(`Повторная попытка через ${onErrorTimeout} мс...`);
    await timeout(onErrorTimeout);
  }

  async handleSendError (tel, error, timeoutMs, retries) {
    const onErrorTimeout = timeoutMs;
    if (retries > 0 && retries % 20 === 0) {
      log.error(`Не удалось отправить SMS на номер ${tel} после ${retries} попыток.`);
      sendTelegram(`Не удалось отправить SMS на номер ${tel} после ${retries} попыток.`);
    }
    log.error(`Ошибка при отправке SMS на номер ${tel}:`, error.message);
    log.error(`Error object: ${JSON.stringify(error)}`);
    log.info(`Повторная попытка через ${onErrorTimeout} мс...`);
    await timeout(onErrorTimeout);
  }

  async getTelsFromAttachments (email) {
    const result = [];
    const attachments = await this.getEmailAttachmentsText(email);
    for (const attachment of attachments) {
      result.push(...this.extractTelsfromCsvText(attachment));
    }
    return result;
  }

  extractTels (text) {
    const re = /^\d{11}$/;
    if (! text) return [];
    const tels = text.replaceAll(/[\+\-\s\t\n\(\)]/g, '').split(';').filter(Boolean).filter(re.test.bind(re));
    return tels ? tels : [];
  }

  extractTelsfromCsvText (csv = '') {
    const re = /^\d{11}$/;
    const tels = csv.split(/,|\n|\r/).filter(Boolean).filter(re.test.bind(re));
    return tels ? tels : [];
  }

  async processTel (tel, message) {
    const response = await this.smsClient.sendMessage(tel, message);
    log.info(`SMS sent successfully Tel: ${tel} Message: ${message}`);
    // log.info(`SMS sent successfully: ${response}\nTel: ${tel}\nMessage: ${message}`);
  }

  async getEmailAttachmentsText (email) {
    const result = [];
    for (const attachment of email.Attachments.items) {
      await attachment.Load();
      result.push(atob(attachment.Base64Content));
    }
    return result;
  }

  async checkSubscription () {
    if (!this.subscription || !this.subscription.IsOpen) {
      this.subscription = await this.exchangeClient.createSubscription(this.handleNotificationEvent.bind(this));
      this.subscription.Open();
    }
  }

  closeSubscription () {
    if (this.subscription) {
      this.subscription.Close();
    }
  }
}
