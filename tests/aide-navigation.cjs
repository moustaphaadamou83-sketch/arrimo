'use strict';
/** Ouvre un écran par la navigation principale comme un utilisateur : sur téléphone, le menu tiroir est d'abord ouvert. */
async function allerOnglet(page, vue) {
  const menu = page.locator('#b-nav');
  if (await menu.isVisible().catch(() => false) && await menu.getAttribute('aria-expanded') !== 'true') {
    await menu.click();
    await page.waitForFunction(() => document.body.classList.contains('nav-ouverte'));
  }
  await page.click(`#onglets button[data-v="${vue}"]`);
}
module.exports = { allerOnglet };
