import crypto from 'node:crypto';
import { get, run, now } from '../db.js';
import { hashCode, safeEqual } from './crypto.js';

/**
 * 零依赖图形验证码：服务端直接生成 SVG，前端 <img src="data:image/svg+xml..."> 或内联展示。
 * 只存哈希、一次性使用、5 分钟过期。
 */

const ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'; // 去掉 0/O/1/I 等易混字符
const TTL_MS = 5 * 60 * 1000;
const LENGTH = 4;

function pick() {
  return ALPHABET[crypto.randomInt(0, ALPHABET.length)];
}

function rand(min, max) {
  return crypto.randomInt(min, max + 1);
}

function escapeXml(s) {
  return String(s).replace(/[<>&"']/g, (c) => ({
    '<': '&lt;',
    '>': '&gt;',
    '&': '&amp;',
    '"': '&quot;',
    "'": '&apos;',
  })[c]);
}

/** 生成带干扰线、噪点、随机旋转与错位的 SVG */
function buildSvg(code) {
  const w = 132;
  const h = 44;
  const parts = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-label="图形验证码">`,
    `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">`,
    `<stop offset="0" stop-color="#f7e9f0"/><stop offset="1" stop-color="#eef1fb"/>`,
    `</linearGradient></defs>`,
    `<rect width="${w}" height="${h}" rx="8" fill="url(#g)"/>`,
  ];

  // 干扰曲线
  for (let i = 0; i < 3; i++) {
    const y1 = rand(6, h - 6);
    const y2 = rand(6, h - 6);
    parts.push(
      `<path d="M0 ${y1} Q ${rand(20, 50)} ${rand(0, h)} ${rand(60, 90)} ${rand(6, h - 6)} T ${w} ${y2}" ` +
        `stroke="rgba(${rand(110, 170)},${rand(90, 150)},${rand(110, 170)},0.26)" stroke-width="${rand(1, 2)}" fill="none"/>`
    );
  }

  // 噪点
  for (let i = 0; i < 18; i++) {
    parts.push(
      `<circle cx="${rand(2, w - 2)}" cy="${rand(2, h - 2)}" r="${rand(1, 2)}" fill="rgba(${rand(60, 150)},${rand(60, 150)},${rand(60, 150)},0.2)"/>`
    );
  }

  // 字符
  const step = (w - 24) / LENGTH;
  for (let i = 0; i < code.length; i++) {
    const x = 16 + i * step + rand(-2, 2);
    const y = h / 2 + rand(-3, 5);
    const rot = rand(-22, 22);
    const size = rand(27, 32);
    const color = ['#3d1226', '#131f3d', '#241338', '#0f3327', '#3a2408'][rand(0, 4)];
    parts.push(
      `<text x="${x}" y="${y}" font-family="Georgia,'Times New Roman',serif" font-size="${size}" ` +
        `font-weight="800" letter-spacing="1" fill="${color}" text-anchor="middle" dominant-baseline="middle" ` +
        `transform="rotate(${rot} ${x} ${y})">${escapeXml(code[i])}</text>`
    );
  }

  parts.push('</svg>');
  return parts.join('');
}

export function createCaptcha() {
  const code = Array.from({ length: LENGTH }, pick).join('');
  const id = crypto.randomBytes(12).toString('hex');
  run(
    'INSERT INTO captchas(id, code_hash, expires_at, created_at) VALUES(?,?,?,?)',
    id,
    hashCode(code),
    now() + TTL_MS,
    now()
  );
  return { id, code, svg: buildSvg(code), ttl: TTL_MS };
}

/** 校验并立即作废（无论对错，防止暴力试错） */
export function consumeCaptcha(id, input) {
  if (!id || !input) return false;
  const row = get('SELECT * FROM captchas WHERE id = ?', String(id));
  if (!row) return false;
  if (row.used || row.expires_at < now()) {
    run('DELETE FROM captchas WHERE id = ?', row.id);
    return false;
  }
  run('UPDATE captchas SET used = 1 WHERE id = ?', row.id);
  return safeEqual(row.code_hash, hashCode(String(input).trim().toUpperCase()));
}

export function cleanupCaptchas() {
  run('DELETE FROM captchas WHERE expires_at < ?', now() - 3600_000);
}
