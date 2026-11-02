// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

export const randomInt = (min: number, max: number, round: number = 1) => {
  const steps = Math.floor((max - min) / round);
  return min + (Math.floor(Math.random() * (steps + 1)) * round);
};

export const randomString = (length: number, type: 'ALPHA' | 'NUM' | 'ALPHANUM' | 'ZENKAKU') => {
  let chars = '';
  if (type === 'ALPHA') chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
  else if (type === 'NUM') chars = '0123456789';
  else if (type === 'ALPHANUM') chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  else if (type === 'ZENKAKU') chars = 'あいうえおかきくけこさしすせそたちつてとなにぬねのはひふへほまみむめもやゆよらりるれろわをん１２３４５６７８９０ＡＢＣＤＥＦ';
  
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
};
