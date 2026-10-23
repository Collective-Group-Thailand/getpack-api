/**
 * What a document prints of its issuer's branding (D-428, D-429), already resolved for the document's issue time:
 * images as data URIs (the PDF renderer blocks every request but `data:`), the signatory's name and position.
 * Shared by getpack's documents and the factories' ERP documents so both sign and stamp the same way.
 */
export interface RenderBranding {
  logo: string | null;
  seal: string | null;
  signature: { image: string | null; name: string; position: string } | null;
}

export const NO_BRANDING: RenderBranding = { logo: null, seal: null, signature: null };

const esc = (v: string | null | undefined) =>
  String(v ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');

/** CSS for the signature block; the seal overlaps the signature the way a stamp on paper does. */
export const SIGN_STYLE = `
  .signed { position: relative; height: 62px; display: flex; align-items: flex-end; justify-content: center; }
  .signed .ink { max-height: 58px; max-width: 170px; position: relative; z-index: 2; }
  .signed .seal { position: absolute; max-height: 84px; max-width: 84px; right: 0; bottom: -4px; opacity: .9; z-index: 1; }
  .signed .dots { width: 100%; border-bottom: 1px dotted #333; position: absolute; bottom: 0; left: 0; }
  .signer { font-size: 10pt; margin-top: 3px; }
`;

/**
 * The issuer's signature cell: the signature image (or the dotted line), the seal when the rule stamps it, then
 * "(name)" and the position, then the cell's own label. `date` is printed when known, else a blank to fill in.
 */
export function issuerSignatureHtml(label: string, b: RenderBranding, date: string | null): string {
  const sig = b.signature;
  return `<div class="signed">${sig?.image ? `<img class="ink" src="${sig.image}" alt="">` : ''}${
    b.seal ? `<img class="seal" src="${b.seal}" alt="">` : ''
  }<div class="dots"></div></div>${
    sig ? `<div class="signer">(${esc(sig.name)})<br>${esc(sig.position)}</div>` : ''
  }<div>${esc(label)}</div><div>วันที่ ${date ? esc(date) : '........./........./.........'}</div>`;
}
