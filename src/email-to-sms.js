import EmailProcessor from './EmailProcessor.js';
import log from './log.js';
import process from 'process';
import options from '../conf/options.js';
import {timeout} from './Util.js';
import sendTelegram from './sendTelegram.js';

const emailProcessor = new EmailProcessor(options);

try {
  await emailProcessor.init();
  log.info('Service started');
  await sendTelegram('🟢 Service started');
} catch (error) {
  log.error('Service start error:', error.message);
  log.debug(error);
  await sendTelegram('🔴 Service start error:', error.message);
  throw error;
}

let stopSignal;
let stopResolve;

const stopHandler = (signal) => {
  log.info('OS signal received:', signal);
  emailProcessor.stop();
  stopSignal = true;
  if (stopResolve) stopResolve();
};
process.on('SIGINT', stopHandler);
process.on('SIGTERM', stopHandler);

(async function main () {
  try {
    await emailProcessor.run();
  } catch (error) {
    log.error('Service error:', error.message);
    log.debug(error);
    await sendTelegram('🟠 Service error:', error.message);

    if (options.errorStategy === 'fail') {
      const exitMsg = `Error stategy is set to '${options.errorStategy}'. Service stopped`;
      log.info(exitMsg);
    } else if (options.errorStategy === 'retry') {
      const retryMsg = `Error stategy is set to '${options.errorStategy}'. Retry in ${options.timeout / 1000} sec.`;
      log.info(retryMsg);

      await Promise.race([
        timeout(options.timeout),
        new Promise((resolve) => {
          stopResolve = resolve;
        }),
      ]);

      if (!stopSignal) {
        await main();
      }
    } else {
      log.error('options.errorStategy parameter is not defined!');
    }
  } finally {
    log.info('Service stopped');
    await sendTelegram('🔴 Service stopped');
    process.exit(0);
  }
})();
