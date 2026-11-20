import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ApiError } from '@/lib/api';
import { ADHERA_CONTACT } from '@/lib/adhera';
import { canDo, standingOf, STANDING_LABELS } from '@/lib/bureau/types';
import { deName, elides, queName } from '@/lib/elision';
import { BUREAU_LICENCE_TEXT, licenceCode, MEMBER_UNAVAILABLE_TEXT } from '@/lib/licence';

/* ───────────────────────── F7 — le socle ───────────────────────── */

describe('F7 § 5 — le contact d’Adhera', () => {
  it('les coordonnées du brief, telles quelles', () => {
    expect(ADHERA_CONTACT.whatsappUrl).toBe('https://wa.me/221782414064');
    expect(ADHERA_CONTACT.email).toBe('contact@adhera.africa');
  });

  it('une constante, à un seul endroit : ni le numéro ni l’adresse ailleurs dans src/', () => {
    const SRC = join(process.cwd(), 'src');
    const walk = (dir: string): string[] =>
      readdirSync(dir).flatMap((name) => {
        const path = join(dir, name);
        return statSync(path).isDirectory() ? walk(path) : [path];
      });
    const offenders = walk(SRC)
      .filter((file) => /\.(ts|tsx)$/.test(file))
      .filter((file) => relative(process.cwd(), file) !== 'src/lib/adhera.ts')
      .filter((file) => /782414064|78 241 40 64|contact@adhera\.africa/.test(readFileSync(file, 'utf8')))
      .map((file) => relative(process.cwd(), file));
    expect(offenders).toEqual([]);
  });
});

describe('§23.7 — l’élision des phrases composées à l’écran', () => {
  it('« d’ » devant une voyelle, accentuée ou non, et devant un h', () => {
    expect(deName('Aminata Diop')).toBe('d’Aminata Diop');
    expect(deName('Ousmane')).toBe('d’Ousmane');
    expect(deName('Émilie Faye')).toBe('d’Émilie Faye');
    expect(deName('Habib Sy')).toBe('d’Habib Sy');
    expect(queName('Ousmane')).toBe('qu’Ousmane');
    expect(queName('Ibrahima')).toBe('qu’Ibrahima');
  });

  it('« de » et « que » restent devant une consonne, et devant un y', () => {
    expect(deName('Moussa Camara')).toBe('de Moussa Camara');
    expect(deName('Yacine Ba')).toBe('de Yacine Ba');
    expect(queName('Fatou')).toBe('que Fatou');
  });

  it('les espaces autour du nom ne trompent pas la règle', () => {
    expect(elides('  Aïssatou')).toBe(true);
    expect(deName('  Awa  ')).toBe('d’Awa');
  });
});

describe('B11 — la licence se lit au code, jamais au message', () => {
  const refus = (code: string | null, message = 'Votre licence a expiré.') => new ApiError(403, code, message);

  it('les trois codes qui arrêtent le service', () => {
    expect(licenceCode(refus('license_expired'))).toBe('license_expired');
    expect(licenceCode(refus('trial_expired'))).toBe('trial_expired');
    expect(licenceCode(refus('tenant_inactive'))).toBe('tenant_inactive');
  });

  it('contre-épreuve : un autre code, aucun code, ou un message seul ne sont pas une licence', () => {
    expect(licenceCode(refus('feature_disabled'))).toBeNull();
    expect(licenceCode(refus('role_not_allowed'))).toBeNull();
    expect(licenceCode(refus(null, 'license_expired'))).toBeNull();
    expect(licenceCode(new Error('license_expired'))).toBeNull();
  });

  it('les phrases décidées par Alioune, une par code côté bureau, une seule côté membre', () => {
    expect(BUREAU_LICENCE_TEXT).toEqual({
      license_expired: 'La licence de votre association a expiré. Pour la renouveler, écrivez à Adhera.',
      trial_expired: 'La période d’essai de votre association est terminée. Pour continuer, écrivez à Adhera.',
      tenant_inactive: 'L’espace de votre association est suspendu. Pour en savoir plus, écrivez à Adhera.',
    });
    expect(MEMBER_UNAVAILABLE_TEXT).toBe('Ce service est momentanément indisponible. Contactez votre association.');
  });
});

describe('§23.3 — « À payer » et « En retard » sont deux états', () => {
  it('la valeur servie fait foi', () => {
    expect(standingOf({ standing: 'to_pay', is_up_to_date: false })).toBe('to_pay');
    expect(standingOf({ standing: 'late', is_up_to_date: false })).toBe('late');
    expect(standingOf({ standing: 'up_to_date', is_up_to_date: true })).toBe('up_to_date');
  });

  it('d’un serveur antérieur à S9 : « pas à jour » se lisait « en retard »', () => {
    expect(standingOf({ is_up_to_date: false })).toBe('late');
    expect(standingOf({ is_up_to_date: true })).toBe('up_to_date');
  });

  it('l’écran traduit l’identifiant', () => {
    expect(STANDING_LABELS).toEqual({ up_to_date: 'À jour', late: 'En retard', to_pay: 'À payer' });
  });
});

describe('§23.2 — `can` masque un geste, il ne garde rien', () => {
  const me = (can?: { cancel_payment: boolean; admit_application: boolean; delete_photo: boolean }) => ({
    name: 'Awa',
    email: 'a@b.sn',
    role: 'president',
    role_label: 'Président',
    ...(can ? { can } : {}),
  });

  it('`false` masque, `true` montre', () => {
    const president = me({ cancel_payment: false, admit_application: true, delete_photo: true });
    expect(canDo(president, 'cancel_payment')).toBe(false);
    expect(canDo(president, 'admit_application')).toBe(true);
  });

  it('sans réponse de `admin/me`, ou d’un serveur antérieur : rien n’est masqué, le serveur tranche', () => {
    expect(canDo(null, 'cancel_payment')).toBe(true);
    expect(canDo(me(), 'delete_photo')).toBe(true);
  });
});

/* ───────────────────────── Les garde-fous de S8 ───────────────────────── */

const SRC_DIR = join(process.cwd(), 'src');
function sources(): string[] {
  const walk = (dir: string): string[] =>
    readdirSync(dir).flatMap((name) => {
      const path = join(dir, name);
      return statSync(path).isDirectory() ? walk(path) : [path];
    });
  return walk(SRC_DIR).filter((file) => /\.(ts|tsx)$/.test(file));
}
/** Le code sans ses commentaires : un commentaire peut citer ce que l'écran ne dit pas. */
function code(file: string): string {
  return readFileSync(file, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

describe('§22 — le rythme est celui du serveur, jamais « par an » écrit à l’écran', () => {
  it('« par an » n’existe que dans le choix du formulaire (avant que le serveur ne compose)', () => {
    const offenders = sources()
      .filter((file) => /(?<!\p{L})par an(?!\p{L})/u.test(code(file)))
      .map((file) => relative(process.cwd(), file));
    expect(offenders).toEqual(['src/lib/bureau/types.ts']);
  });
});

describe('§22.8 — trois messages ne sont plus composés à l’écran', () => {
  it('`whatsappLink` ne sert plus qu’à l’invitation d’un membre (texte servi, `referral.share_text`)', () => {
    const callers = sources()
      .filter((file) => relative(process.cwd(), file) !== 'src/lib/whatsapp.ts')
      .filter((file) => /\bwhatsappLink\(/.test(code(file)))
      .map((file) => relative(process.cwd(), file));
    expect(callers).toEqual(['src/app/m/[token]/MemberPage.tsx']);
  });
});
