'use client';

import { useBureau } from './BureauContext';
import { Notice } from './ui';

/**
 * §22.4 (S8) — les avertissements des réglages (« période courte +
 * current_only »…), servis par le GET ET le PUT de `settings`. Affichés à
 * chaque rendu, TELS QUELS : l'écran ne force rien, il dit.
 */
export function SettingsWarnings() {
  const { settings } = useBureau();
  const warnings = (settings.warnings ?? []).filter((w) => w.message?.trim());
  if (warnings.length === 0) return null;
  return (
    <div className="flex flex-col gap-2" data-testid="settings-warnings">
      {warnings.map((warning) => (
        <Notice key={warning.code} tone="due">
          {warning.message}
        </Notice>
      ))}
    </div>
  );
}
