/**
 * @vitest-environment jsdom
 * @vitest-environment-options { "url": "https://demo-asso.adhera.africa/m/aaaa" }
 */

import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SaveCard } from '@/components/card/SaveCard';
import { detectInstallEnv, resetInstallPromptForTests } from '@/lib/install';

const UA = {
  androidChrome:
    'Mozilla/5.0 (Linux; Android 14; SM-A146B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36',
  iphoneSafari:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Mobile/15E148 Safari/604.1',
  whatsappAndroid:
    'Mozilla/5.0 (Linux; Android 14; SM-A146B; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/131.0.0.0 Mobile Safari/537.36 WhatsApp/2.24.25.78',
  facebookIos:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/FBIOS;FBAV/480.0.0.0]',
  instagramAndroid:
    'Mozilla/5.0 (Linux; Android 14; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/131.0.0.0 Mobile Safari/537.36 Instagram 350.0.0.0',
  desktopFirefox: 'Mozilla/5.0 (X11; Linux x86_64; rv:132.0) Gecko/20100101 Firefox/132.0',
};

describe('detectInstallEnv — la règle', () => {
  it('Android et Chrome, avec l’invite retenue : prompt', () => {
    expect(detectInstallEnv({ userAgent: UA.androidChrome, standalone: false, canPrompt: true })).toBe('prompt');
  });
  it('iPhone et Safari : la notice', () => {
    expect(detectInstallEnv({ userAgent: UA.iphoneSafari, standalone: false, canPrompt: false })).toBe('ios');
  });
  it('un iPad qui se dit Macintosh : la notice aussi', () => {
    const ipad = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Safari/605.1.15';
    expect(detectInstallEnv({ userAgent: ipad, standalone: false, canPrompt: false, maxTouchPoints: 5 })).toBe('ios');
    expect(detectInstallEnv({ userAgent: ipad, standalone: false, canPrompt: false, maxTouchPoints: 0 })).toBe('none');
  });
  it('les navigateurs intégrés de WhatsApp, Facebook, Instagram : in-app, même s’ils promettent une invite', () => {
    for (const userAgent of [UA.whatsappAndroid, UA.facebookIos, UA.instagramAndroid]) {
      expect(detectInstallEnv({ userAgent, standalone: false, canPrompt: true })).toBe('in-app');
    }
  });
  it('déjà installée : rien, quel que soit le navigateur', () => {
    for (const userAgent of Object.values(UA)) {
      expect(detectInstallEnv({ userAgent, standalone: true, canPrompt: true })).toBe('installed');
    }
  });
  it('ni invite, ni iPhone (Firefox, un ordinateur) : rien', () => {
    expect(detectInstallEnv({ userAgent: UA.desktopFirefox, standalone: false, canPrompt: false })).toBe('none');
    expect(detectInstallEnv({ userAgent: UA.androidChrome, standalone: false, canPrompt: false })).toBe('none');
  });
});

function setUserAgent(value: string) {
  vi.spyOn(window.navigator, 'userAgent', 'get').mockReturnValue(value);
}

function setStandalone(matches: boolean) {
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) => ({
      matches: query === '(display-mode: standalone)' ? matches : false,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  );
}

beforeEach(() => {
  resetInstallPromptForTests();
  setStandalone(false);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const draw = vi.hoisted(() => ({
  drawCard: vi.fn(),
  cardFileName: vi.fn(() => 'carte-aminata-diop.png'),
}));
vi.mock('@/components/card/cardImage', () => draw);

const CARD = {
  organisation_name: 'Cercle des Administrateurs Publics',
  logo_url: null,
  icon_url: null,
  display_name: 'Aminata Diop',
  first_name: 'Aminata',
  last_name: 'Diop',
  type: 'personne' as const,
  category_label: 'Membre actif',
  member_number: '0001',
  member_since: '2026-03-10',
  is_up_to_date: true,
  valid_until: '2027-03-09',
  standing_label: 'À jour',
  verify_url: 'https://demo-asso.adhera.africa/v/5RGF6J9Z2UJX',
};

/**
 * F5 — « Enregistrer ma carte dans mes photos » remplace « Garder sur mon
 * téléphone » : l'image PNG sort par trois chemins, selon le téléphone.
 */
function stubShare(share: unknown, canShare: unknown) {
  Object.defineProperty(navigator, 'share', { value: share, configurable: true, writable: true });
  Object.defineProperty(navigator, 'canShare', { value: canShare, configurable: true, writable: true });
}

describe('« Enregistrer ma carte dans mes photos » — les trois chemins', () => {
  afterEach(() => {
    delete (navigator as unknown as Record<string, unknown>).share;
    delete (navigator as unknown as Record<string, unknown>).canShare;
  });

  beforeEach(() => {
    draw.drawCard.mockResolvedValue({
      blob: new Blob(['png'], { type: 'image/png' }),
      dataUrl: 'data:image/png;base64,AAAA',
    });
  });

  it('dans WhatsApp : l’image en plein écran, « Appuyez longuement », ni partage ni téléchargement', async () => {
    setUserAgent(UA.whatsappAndroid);
    const share = vi.fn();
    stubShare(share, () => true);
    render(<SaveCard card={CARD} />);
    await userEvent.click(screen.getByRole('button', { name: 'Enregistrer ma carte dans mes photos' }));
    const dialog = await screen.findByRole('dialog', { name: 'Ma carte, à enregistrer' });
    expect(dialog).toHaveTextContent('Appuyez longuement sur l’image, puis Enregistrer');
    expect(screen.getByRole('img', { name: 'Ma carte de membre' })).toHaveAttribute(
      'src',
      'data:image/png;base64,AAAA',
    );
    expect(share).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Fermer' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('quand le téléphone sait partager un fichier : navigator.share({ files })', async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    setUserAgent(UA.androidChrome);
    stubShare(share, () => true);
    render(<SaveCard card={CARD} />);
    await userEvent.click(screen.getByRole('button', { name: 'Enregistrer ma carte dans mes photos' }));
    await vi.waitFor(() => expect(share).toHaveBeenCalledTimes(1));
    const files = share.mock.calls[0]?.[0].files as File[];
    expect(files[0]?.name).toBe('carte-aminata-diop.png');
    expect(files[0]?.type).toBe('image/png');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('sinon : un téléchargement carte-{prenom}-{nom}.png', async () => {
    setUserAgent(UA.desktopFirefox);
    const createObjectURL = vi.fn(() => 'blob:carte');
    Object.defineProperty(URL, 'createObjectURL', { value: createObjectURL, configurable: true, writable: true });
    Object.defineProperty(URL, 'revokeObjectURL', { value: vi.fn(), configurable: true, writable: true });
    const clicked: string[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      clicked.push(this.download);
    });
    render(<SaveCard card={CARD} />);
    await userEvent.click(screen.getByRole('button', { name: 'Enregistrer ma carte dans mes photos' }));
    await vi.waitFor(() => expect(clicked).toEqual(['carte-aminata-diop.png']));
    expect(createObjectURL).toHaveBeenCalledTimes(1);
  });

  it('un dessin impossible se dit, et propose la capture d’écran', async () => {
    draw.drawCard.mockRejectedValue(new Error('Canvas indisponible'));
    render(<SaveCard card={CARD} />);
    await userEvent.click(screen.getByRole('button', { name: 'Enregistrer ma carte dans mes photos' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Faites une capture d’écran de la carte.');
  });
});
