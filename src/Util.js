import options from '../conf/options.js';

export function timeout (ms = options.timeout) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export function onlyUnique (value, index, array) {
  return array.indexOf(value) === index;
}
