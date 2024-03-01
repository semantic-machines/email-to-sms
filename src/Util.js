import options from '../conf/options.js';

export function timeout (ms = options.timeout) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
