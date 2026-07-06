function hexToBytes(hex: string): Uint8Array {
    const bytes = new Uint8Array(hex.length / 2);
    for (let i = 0; i < bytes.length; i++) {
        bytes[i] = parseInt(hex.substring(i * 2, i * 2 + 2), 16);
    }
    return bytes;
}

/**
 * Verifies a Discord interaction request signature (Ed25519, supported natively
 * by workerd's WebCrypto).
 */
export async function verifyDiscordRequest(
    publicKey: string,
    signature: string | null,
    timestamp: string | null,
    body: string
): Promise<boolean> {
    if (!signature || !timestamp) return false;
    try {
        const key = await crypto.subtle.importKey(
            'raw',
            hexToBytes(publicKey),
            { name: 'Ed25519' },
            false,
            ['verify']
        );
        return await crypto.subtle.verify(
            'Ed25519',
            key,
            hexToBytes(signature),
            new TextEncoder().encode(timestamp + body)
        );
    } catch {
        return false;
    }
}
