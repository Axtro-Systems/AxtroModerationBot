import { createCanvas, loadImage } from '@napi-rs/canvas';

/**
 * Renders a minimalist, modern welcome card.
 * Clean geometry, single-accent palette, content sized to fill the canvas properly.
 */
export async function createWelcomeCard(username, memberCount, avatarUrl) {
  const width = 1000;
  const height = 420;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');

  ctx.clearRect(0, 0, width, height);

  // ---- 1. Flat dark background ----
  const bgGrad = ctx.createLinearGradient(0, 0, 0, height);
  bgGrad.addColorStop(0, '#111318');
  bgGrad.addColorStop(1, '#0a0b0e');
  ctx.fillStyle = bgGrad;
  ctx.fillRect(0, 0, width, height);

  // ---- 2. Subtle accent glow, top-right ----
  ctx.save();
  const orb = ctx.createRadialGradient(width - 100, 40, 0, width - 100, 40, 450);
  orb.addColorStop(0, 'rgba(99, 102, 241, 0.12)');
  orb.addColorStop(1, 'rgba(0, 0, 0, 0)');
  ctx.fillStyle = orb;
  ctx.fillRect(0, 0, width, height);
  ctx.restore();

  const roundRect = (x, y, w, h, r) => {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  };

  // ---- 3. Card panel ----
  const cardX = 20, cardY = 20;
  const cardW = width - 40, cardH = height - 40;
  const cardRadius = 18;

  ctx.save();
  ctx.shadowColor = 'rgba(0, 0, 0, 0.5)';
  ctx.shadowBlur = 30;
  ctx.shadowOffsetY = 10;
  roundRect(cardX, cardY, cardW, cardH, cardRadius);
  ctx.fillStyle = 'rgba(17, 20, 27, 0.9)';
  ctx.fill();
  ctx.restore();

  ctx.save();
  roundRect(cardX, cardY, cardW, cardH, cardRadius);
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.restore();

  // ---- 4. Avatar ----
  const avatarSize = 150;
  const avatarRadius = avatarSize / 2;
  const avatarX = cardX + 115;
  const avatarY = cardY + cardH / 2;

  ctx.save();
  ctx.strokeStyle = 'rgba(129, 140, 248, 0.65)';
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.arc(avatarX, avatarY, avatarRadius + 6, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();

  try {
    const avatarImg = await loadImage(avatarUrl);
    ctx.save();
    ctx.beginPath();
    ctx.arc(avatarX, avatarY, avatarRadius, 0, Math.PI * 2);
    ctx.closePath();
    ctx.clip();
    ctx.drawImage(avatarImg, avatarX - avatarRadius, avatarY - avatarRadius, avatarSize, avatarSize);
    ctx.restore();
  } catch (err) {
    ctx.save();
    ctx.fillStyle = '#1c2029';
    ctx.beginPath();
    ctx.arc(avatarX, avatarY, avatarRadius, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#e4e6eb';
    ctx.font = '600 46px "Segoe UI", Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(username.substring(0, 2).toUpperCase(), avatarX, avatarY);
    ctx.restore();
  }

  // Thin vertical divider between avatar and text sections
  const dividerX = cardX + 225;
  ctx.save();
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(dividerX, cardY + 50);
  ctx.lineTo(dividerX, cardY + cardH - 50);
  ctx.stroke();
  ctx.restore();

  // ---- 5. Text block — now uses full available width ----
  const textLeftX = dividerX + 45;
  const textRightLimit = cardX + cardW - 45; // extends close to right edge

  // Eyebrow label (letter-spaced)
  ctx.save();
  ctx.fillStyle = 'rgba(165, 180, 252, 0.95)';
  ctx.font = '700 19px "Segoe UI", Arial, sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  const eyebrow = 'W E L C O M E';
  ctx.fillText(eyebrow, textLeftX, cardY + 80);
  ctx.restore();

  // Display name — large, auto-fit to full available width
  ctx.save();
  ctx.fillStyle = '#f8f9fb';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';

  const maxNameWidth = textRightLimit - textLeftX;
  let nameFontSize = 66;
  let displayName = username;
  ctx.font = `800 ${nameFontSize}px "Segoe UI", Arial, sans-serif`;
  while (ctx.measureText(displayName).width > maxNameWidth && nameFontSize > 34) {
    nameFontSize -= 2;
    ctx.font = `800 ${nameFontSize}px "Segoe UI", Arial, sans-serif`;
  }
  // If still too long at min size, truncate
  while (ctx.measureText(displayName).width > maxNameWidth && displayName.length > 1) {
    displayName = displayName.slice(0, -1);
  }
  if (displayName !== username) displayName = `${displayName.slice(0, -1)}…`;

  ctx.fillText(displayName, textLeftX, cardY + 148);
  ctx.restore();

  // Subtitle
  ctx.save();
  ctx.fillStyle = '#9a9eab';
  ctx.font = '500 23px "Segoe UI", Roboto, Arial, sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText('Glad to have you on the server', textLeftX, cardY + 186);
  ctx.restore();

  // ---- 6. Member count — wide bar spanning the full text column width ----
  const tagY = cardY + 220;
  const tagH = 56;
  const tagW = textRightLimit - textLeftX; // fills the same width as the name/subtitle above

  ctx.save();
  roundRect(textLeftX, tagY, tagW, tagH, 14);
  const tagGrad = ctx.createLinearGradient(textLeftX, tagY, textLeftX + tagW, tagY);
  tagGrad.addColorStop(0, 'rgba(129, 140, 248, 0.16)');
  tagGrad.addColorStop(1, 'rgba(129, 140, 248, 0.06)');
  ctx.fillStyle = tagGrad;
  ctx.fill();
  ctx.strokeStyle = 'rgba(129, 140, 248, 0.3)';
  ctx.lineWidth = 1;
  ctx.stroke();

  // Left-aligned label + right-aligned number, spanning full bar width
  ctx.fillStyle = '#c7cdfb';
  ctx.font = '600 20px "Segoe UI", Arial, sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText('MEMBER COUNT', textLeftX + 22, tagY + tagH / 2 + 1);

  ctx.fillStyle = '#ffffff';
  ctx.font = '800 26px "Segoe UI", Arial, sans-serif';
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  ctx.fillText(`#${memberCount}`, textLeftX + tagW - 22, tagY + tagH / 2 + 1);
  ctx.restore();

  return canvas.toBuffer('image/png');
}
