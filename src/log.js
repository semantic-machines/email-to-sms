import log from 'loglevel';
import prefix from 'loglevel-plugin-prefix';
import options from '../conf/options.js';

log.setLevel(options.logLevel || 'info');
prefix.reg(log);
prefix.apply(log, {
  template: '%t [%l] -',
  levelFormatter: function (level) {
    return level.toUpperCase();
  },
  nameFormatter: function (name) {
    return name || 'root';
  },
  timestampFormatter: function (date) {
    return date.toISOString();
  },
  format: undefined,
});

export default log;
