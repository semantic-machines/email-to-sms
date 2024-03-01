import options from '../conf/options.js';
import log from './log.js';

let tries = options.telegram.tries;

export default async function sendTelegram (...args) {
  --tries;
  try {
    const formatted = encodeURIComponent(['*' + options.name + ':*', ...args].join('\n'));
    await fetch(`https://api.telegram.org/bot${options.telegram.botToken}/sendMessage?chat_id=${options.telegram.chatId}&parse_mode=Markdown&text=${formatted}`);
  } catch (error) {
    log.error('Failed to send telegram:', error.message);
    log.debug(error);
    log.error('Tries left:', tries);
    if (tries > 0) await sendTelegram(...args);
  } finally {
    tries = options.telegram.tries;
  }
}
