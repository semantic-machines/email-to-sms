import ews from 'ews-javascript-api';
import {XhrApi} from '@ewsjs/xhr';
import log from './log.js';

export default class ExchangeClient {
  static #instance;

  constructor (options) {
    if (ExchangeClient.#instance) return ExchangeClient.#instance;
    ExchangeClient.#instance = this;

    this.options = options;
  }

  init () {
    const xhr = new XhrApi({rejectUnauthorized: false, gzip: true}).useNtlmAuthentication(this.options.user, this.options.password);
    ews.ConfigurationApi.ConfigureXHR(xhr);
    this.exchange = new ews.ExchangeService(ews.ExchangeVersion.Exchange2016);
    this.exchange.Url = new ews.Uri(this.options.server);
    this.exchange.Credentials = new ews.ExchangeCredentials(this.options.user, this.options.password);
  }

  async getEmails (batchSize, offset = 0) {
    try {
      const folder = ews.WellKnownFolderName.Inbox;
      const view = new ews.ItemView(batchSize, offset);
      view.OrderBy.Add(ews.ItemSchema.DateTimeReceived, ews.SortDirection.Ascending);
      const filter = new ews.SearchFilter.IsEqualTo(ews.EmailMessageSchema.IsRead, false);
      const findResults = await this.exchange.FindItems(folder, filter, view);
      const emails = await Promise.all(findResults.Items.map(async (item) => await this.downloadEmail(item.Id)));
      log.debug(`finish getEmails`);
      return emails;
    } catch (error) {
      log.error('Error fetching emails:', error.message);
      log.debug(error);
      throw error;
    }
  }

  async getAllNewEmails (batchSize) {
    const emails = [];
    let newEmails = await this.getEmails(batchSize);
    emails.push(...newEmails);
    let offset = 0;
    while (newEmails.length == batchSize) {
      offset += batchSize;
      newEmails = await this.getEmails(batchSize, offset);
      emails.push(...newEmails);
    }
    return emails;
  }

  async deleteEmail (email) {
    try {
      await email.Delete(ews.DeleteMode.HardDelete);
    } catch (error) {
      log.error('Error deleting email:', error.message);
      log.debug(error);
      throw error;
    }
  }

  async downloadEmail (itemId) {
    if (!itemId) return null;
    try {
      const propertySet = new ews.PropertySet(ews.BasePropertySet.IdOnly);
      propertySet.Add(ews.EmailMessageSchema.From);
      propertySet.Add(ews.EmailMessageSchema.Subject);
      propertySet.Add(ews.EmailMessageSchema.TextBody);
      propertySet.Add(ews.EmailMessageSchema.Attachments);
      const email = await this.exchange.BindToItem(itemId, propertySet);
      await email.Load(propertySet);
      return email;
    } catch (error) {
      log.error('Error loading email "from" info:', error.message);
      log.debug(error);
      throw error;
    }
  }

  async createSubscription (callback) {
    try {
      const subscription = await this.exchange.SubscribeToStreamingNotifications(
        [new ews.FolderId(ews.WellKnownFolderName.Inbox)],
        [ews.EventType.NewMail],
      );
      const connection = new ews.StreamingSubscriptionConnection(this.exchange, 30);
      connection.AddSubscription(subscription);
      connection.OnNotificationEvent.push(callback);
      return connection;
    } catch (error) {
      log.error('Failed to add subscription: ', error.message);
      throw error;
    }
  }

  async replyEmail (email, body, fileName) {
    try {
      const reply = email.CreateReply(true);
      reply.Body = new ews.MessageBody(body);
      
      // Добавляем вложение, если fileName передан
      // if (fileName) {
      //   const fs = await import('fs/promises');
      //   try {
      //     const fileContent = await fs.readFile(fileName);
      //     const attachment = new ews.FileAttachment(fileName);
      //     attachment.Content = fileContent;
          
      //     // Инициализируем коллекцию вложений, если она не существует
      //     if (!reply.Attachments) {
      //       reply.Attachments = new ews.AttachmentCollection();
      //     }
          
      //     reply.Attachments.Add(attachment);
      //   } catch (fileError) {
      //     log.error(`Error reading attachment file ${fileName}:`, fileError.message);
      //     // Продолжаем отправку письма без вложения
      //   }
      // }
      
      await reply.Send();
    } catch (error) {
      log.error('Error on reply email:', error.message);
      log.debug(error);
      throw error;
    }
  }

  async markAsRead (email) {
    try {
      email.IsRead = true;
      await email.Update(ews.ConflictResolutionMode.AlwaysOverwrite);
    } catch (error) {
      log.error('Error marking email as read:', error.message);
      log.debug(error);
      throw error;
    }
  }
}
