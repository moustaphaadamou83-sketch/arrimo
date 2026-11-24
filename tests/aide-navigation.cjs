'use strict';
/** Ouvre un écran par la navigation principale comme un utilisateur : sur téléphone, le menu tiroir est d'abord ouvert. */
async function allerOnglet(page, vue) {
  // La mise à jour des espaces et du menu Plus passe par MutationObserver/rAF ; attendre son état stable avant de choisir le chemin.
  await page.evaluate(async (v) => {
    window.ArrimoEspaces?.reveler(v);
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    window.ArrimoNavPlus?.ajuster();
  }, vue).catch(() => {});
  // Journal et support sont volontairement accessibles depuis le centre de paramètres.
  if (await page.locator(`#onglets button[data-v="${vue}"].hors-menu`).count()) {
    await allerOnglet(page, 'params');
    await page.locator(`.params-nav [data-param-nav="${vue}"]:visible`).last().click();
    await page.waitForFunction((v) => document.querySelector(`#onglets button[data-v="${v}"]`)?.getAttribute('aria-selected') === 'true', vue);
    return;
  }
  // Navigation par espaces (22 nov. 2026) : l'espace du module est ouvert d'abord, comme le ferait un utilisateur
  const menu = page.locator('#b-nav');
  if (await menu.isVisible().catch(() => false) && await menu.getAttribute('aria-expanded') !== 'true') {
    await menu.click();
    await page.waitForFunction(() => document.body.classList.contains('nav-ouverte'));
  }
  // Barre d'onglets (22 nov. 2026) : un onglet qui ne tient pas est dans le menu « Plus », comme pour un utilisateur
  if (await page.locator(`#onglets button[data-v="${vue}"].hors-barre`).count() && await page.locator('#b-onglets-plus').isVisible().catch(() => false)) {
    await page.click('#b-onglets-plus');
    await page.waitForSelector('#menu-onglets-plus:not([hidden])');
    await page.click(`#menu-onglets-plus [data-proxy="${vue}"]`);
    return;
  }
  await page.evaluate((v) => window.ArrimoEspaces?.reveler(v), vue).then(() => page.click(`#onglets button[data-v="${vue}"]`));
}
module.exports = { allerOnglet };
