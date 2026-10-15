import React, { useEffect, useState } from 'react';

export function LoginPage({ onLoggedIn }: { onLoggedIn: () => void }) {
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [signInUrl, setSignInUrl] = useState<string | null>(null);

    async function login() {
        setBusy(true);
        setError(null);
        try {
            const result = await window.pdSync.login();
            if (result.ok) {
                onLoggedIn();
            } else {
                setError(result.error ?? 'Sign-in failed');
            }
        } finally {
            setBusy(false);
        }
    }

    useEffect(() => {
        return window.pdSync.on('auth:signInUrl', (url: string) => setSignInUrl(url));
    }, []);

    return (
        <>
            <div className="notice">
                This is a third-party application not officially supported by Proton. Your session is
                stored locally on this computer only.
            </div>
            <section className="panel">
                <h2>Sign in</h2>
                <p style={{ color: 'var(--muted)', fontSize: 14 }}>
                    Click the button below — your browser will open a Proton sign-in page. The app
                    waits here until you finish.
                </p>
                {signInUrl && (
                    <p style={{ fontSize: 13, wordBreak: 'break-all', color: 'var(--muted)' }}>
                        If the browser did not open, copy this link:{' '}
                        <a style={{ color: 'var(--accent)' }} href={signInUrl}>
                            sign-in link
                        </a>
                    </p>
                )}
                {error && <p style={{ color: 'var(--error)', fontSize: 13 }}>{error}</p>}
                <button disabled={busy} onClick={() => void login()}>
                    {busy ? 'Waiting for sign-in…' : 'Sign in with Proton'}
                </button>
            </section>
        </>
    );
}
