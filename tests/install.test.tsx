/**
 * @vitest-environment jsdom
 * @vitest-environment-options { "url": "https://demo-asso.adhera.africa/m/aaaa" }
 */

import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { KeepOnPhone } from '@/components/card/KeepOnPhone';
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

describe('« Garder sur mon téléphone » — les quatre cas', () => {
  it('Android et Chrome : le bouton apparaît avec l’invite, et la déclenche', async () => {
    setUserAgent(UA.androidChrome);
    render(<KeepOnPhone />);
    expect(screen.queryByRole('button', { name: 'Garder sur mon téléphone' })).not.toBeInTheDocument();

    const prompt = vi.fn(async () => undefined);
    const event = Object.assign(new Event('beforeinstallprompt', { cancelable: true }), {
      prompt,
      userChoice: Promise.resolve({ outcome: 'accepted' as const }),
    });
    act(() => {
      window.dispatchEvent(event);
    });
    expect(event.defaultPrevented).toBe(true);

    await userEvent.setup().click(screen.getByRole('button', { name: 'Garder sur mon téléphone' }));
    expect(prompt).toHaveBeenCalledTimes(1);
    // L'invite ne sert qu'une fois : le bouton s'en va.
    expect(screen.queryByRole('button', { name: 'Garder sur mon téléphone' })).not.toBeInTheDocument();
  });

  it('iPhone et Safari : la notice « Touchez Partager, puis “Sur l’écran d’accueil” »', async () => {
    setUserAgent(UA.iphoneSafari);
    render(<KeepOnPhone />);
    const button = screen.getByRole('button', { name: 'Garder sur mon téléphone' });
    expect(button).toHaveAttribute('aria-expanded', 'false');
    await userEvent.setup().click(button);
    const text = screen.getByTestId('keep-ios').textContent ?? '';
    expect(text).toContain('Touchez Partager');
    expect(text).toContain('« Sur l’écran d’accueil »');
  });

  it('le navigateur intégré de WhatsApp : rouvrir dans Chrome ou Safari, et « Copier le lien »', async () => {
    setUserAgent(UA.whatsappAndroid);
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    render(<KeepOnPhone />);
    expect(
      screen.getByText('Ouvrez ce lien dans Chrome (ou Safari sur iPhone) pour garder votre carte.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Garder sur mon téléphone' })).not.toBeInTheDocument();
    const user = userEvent.setup();
    // userEvent remplace le presse-papiers : on réinstalle l'espion.
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    await user.click(screen.getByRole('button', { name: 'Copier le lien de ma carte' }));
    expect(writeText).toHaveBeenCalledWith('https://demo-asso.adhera.africa/m/aaaa');
    expect(screen.getByText('Copié')).toBeInTheDocument();
  });

  it('déjà installée (display-mode: standalone) : le bouton disparaît', () => {
    setUserAgent(UA.iphoneSafari);
    setStandalone(true);
    const { container } = render(<KeepOnPhone />);
    expect(container).toBeEmptyDOMElement();
  });
});
