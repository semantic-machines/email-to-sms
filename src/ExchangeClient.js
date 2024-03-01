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

  async getEmails (batchSize) {
    try {
      const view = new ews.ItemView(batchSize);
      view.OrderBy.Add(ews.ItemSchema.DateTimeReceived, ews.SortDirection.Ascending);
      const filter = new ews.SearchFilter.SearchFilterCollection(ews.LogicalOperator.And);
      filter.Add(new ews.SearchFilter.IsEqualTo(ews.EmailMessageSchema.IsRead, false));
      const findResults = await this.exchange.FindItems(ews.WellKnownFolderName.Inbox, filter, view);
      const emails = await Promise.all(findResults.Items.map(async (item) => await this.downloadEmail(item.Id.UniqueId)));
      return emails;
    } catch (error) {
      log.error('Error fetching emails:', error.message);
      log.debug(error);
      throw error;
    }
  }

  async downloadEmail (id) {
    try {
      const propertySet = new ews.PropertySet(ews.BasePropertySet.FirstClassProperties);
      propertySet.Add(ews.ItemSchema.TextBody);
      const email = await this.exchange.BindToItem(new ews.ItemId(id), propertySet);
      await email.Load(propertySet);
      return email;
    } catch (error) {
      log.error('Error loading email:', error.message);
      log.debug(error);
      throw error;
    }
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
