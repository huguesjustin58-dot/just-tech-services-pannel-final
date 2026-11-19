import React, { useMemo, useRef, useState } from 'react';
import { Check, Copy, Eye, EyeOff, Lock, RotateCcw, Terminal } from 'lucide-react';
import { PAYLOAD_PRESETS, PAYLOAD_QUICK_TAGS } from '../types/sshCloudConfig';

interface RawPayloadEditorProps {
  value: string;
  onChange: (nextValue: string) => void;
  onNotify?: (message: string) => void;
}

/**
 * Éditeur de Payload HTTP brut conçu pour contourner la normalisation DOM de <textarea>
 * (les navigateurs convertissent \r\n en \n lors de la saisie dans un <textarea>).
 * - Aucun .trim() destructif n'est jamais appliqué.
 * - Le mode CRLF (\r\n) préserve strictement les fins de ligne \r\n à chaque frappe et collage.
 * - Le collage (onPaste) capture clipboardData brut afin de retenir 100 % des espaces, \r\n et tags.
 */
export const RawPayloadEditor: React.FC<RawPayloadEditorProps> = ({
  value,
  onChange,
  onNotify,
}) => {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const [copied, setCopied] = useState(false);
  const [previewMode, setPreviewMode] = useState<'raw' | 'escaped'>('raw');
  const [showPreview, setShowPreview] = useState(true);
  const [enforceCrlfLineEndings, setEnforceCrlfLineEndings] = useState<boolean>(() =>
    value.includes('\r\n')
  );

  const metrics = useMemo(() => {
    const crlfCount = (value.match(/\r\n/g) ?? []).length;
    const lfOnlyCount = (value.replace(/\r\n/g, '').match(/\n/g) ?? []).length;
    const leadingSpaces = (value.match(/^[ \t]+/)?.[0] ?? '').length;
    const trailingSpaces = (value.match(/[ \t]+$/)?.[0] ?? '').length;
    const byteLength = new TextEncoder().encode(value).length;
    const escaped = value.replace(/\r\n|\r|\n|\t| /g, (token) => {
      if (token === '\r\n') return '␍␊\n';
      if (token === '\r') return '␍';
      if (token === '\n') return '␊\n';
      if (token === '\t') return '⇥';
      return '·';
    });

    return {
      charCount: value.length,
      byteLength,
      crlfCount,
      lfOnlyCount,
      leadingSpaces,
      trailingSpaces,
      escaped,
    };
  }, [value]);

  // Valeur affichée dans le <textarea> DOM (le DOM convertit naturellement \r\n -> \n à l'affichage)
  const domDisplayValue = useMemo(() => value.replace(/\r\n/g, '\n'), [value]);

  const handleTextareaChange = (domNext: string) => {
    // Re-restitue strictement \r\n si le mode CRLF est actif afin d'empêcher la perte par le DOM
    const preserved = enforceCrlfLineEndings
      ? domNext.replace(/\r?\n/g, '\r\n')
      : domNext;
    onChange(preserved);
  };

  const handleRawPaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const pastedRaw = e.clipboardData?.getData('text/plain');
    if (typeof pastedRaw !== 'string') return;

    e.preventDefault();
    const el = textareaRef.current;
    const containsCrlf = pastedRaw.includes('\r\n');
    if (containsCrlf && !enforceCrlfLineEndings) {
      setEnforceCrlfLineEndings(true);
    }

    const effectiveCrlf = containsCrlf || enforceCrlfLineEndings;
    const normalizedPaste = effectiveCrlf ? pastedRaw.replace(/\r?\n/g, '\r\n') : pastedRaw;

    if (!el) {
      onChange(value + normalizedPaste);
      return;
    }

    // Conversion d'index DOM (\n) -> chaîne courante sans perte d'espaces ni de CRLF
    const startDom = el.selectionStart ?? domDisplayValue.length;
    const endDom = el.selectionEnd ?? domDisplayValue.length;
    const beforeDom = domDisplayValue.slice(0, startDom);
    const afterDom = domDisplayValue.slice(endDom);
    const mergedDom = beforeDom + pastedRaw.replace(/\r\n/g, '\n') + afterDom;
    const finalRaw = effectiveCrlf
      ? beforeDom.replace(/\n/g, '\r\n') + normalizedPaste + afterDom.replace(/\n/g, '\r\n')
      : beforeDom + pastedRaw + afterDom;

    onChange(finalRaw);

    requestAnimationFrame(() => {
      el.focus();
      const nextCaret = beforeDom.length + pastedRaw.replace(/\r\n/g, '\n').length;
      el.setSelectionRange(nextCaret, nextCaret);
    });

    if (mergedDom.length > 0 && containsCrlf) {
      onNotify?.('Collage brut effectué : retours CRLF (\\r\\n) et espaces conservés à 100 %.');
    }
  };

  const insertAtCursor = (snippet: string) => {
    const el = textareaRef.current;
    const snippetHasCrlf = snippet.includes('\r\n');
    const nextEnforceCrlf = snippetHasCrlf || enforceCrlfLineEndings;
    if (snippetHasCrlf && !enforceCrlfLineEndings) {
      setEnforceCrlfLineEndings(true);
    }

    if (!el) {
      onChange(value + snippet);
      return;
    }

    const startDom = el.selectionStart ?? domDisplayValue.length;
    const endDom = el.selectionEnd ?? domDisplayValue.length;
    const beforeDom = domDisplayValue.slice(0, startDom);
    const afterDom = domDisplayValue.slice(endDom);

    const nextRaw = nextEnforceCrlf
      ? beforeDom.replace(/\n/g, '\r\n') + snippet + afterDom.replace(/\n/g, '\r\n')
      : beforeDom + snippet + afterDom;

    onChange(nextRaw);

    requestAnimationFrame(() => {
      el.focus();
      const caret = startDom + snippet.replace(/\r\n/g, '\n').length;
      el.setSelectionRange(caret, caret);
    });
  };

  const handleToggleCrlfLock = () => {
    setEnforceCrlfLineEndings((prev) => {
      const next = !prev;
      if (next && value.includes('\n')) {
        onChange(value.replace(/\r?\n/g, '\r\n'));
      }
      onNotify?.(
        next
          ? 'Verrou CRLF (\\r\\n) activé : chaque saut de ligne est stocké en \\r\\n brut.'
          : 'Verrou CRLF désactivé : sauts de ligne conservés en LF (\\n).'
      );
      return next;
    });
  };

  const handleCopyRaw = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      onNotify?.('Payload brut copié octet par octet (zéro .trim(), CRLF et espaces préservés).');
      setTimeout(() => setCopied(false), 1600);
    } catch {
      onNotify?.('Copie presse-papiers impossible dans ce navigateur.');
    }
  };

  return (
    <div className="space-y-3">
      {/* En-tête éditeur + presets */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h4 className="text-sm font-semibold text-[#F2F6FF] flex items-center gap-2">
            <Terminal className="w-4 h-4 text-[#45D7F4]" />
            Éditeur de Payload HTTP Brut
          </h4>
          <p className="text-xs text-[#8D9AAF] mt-0.5">
            Rétention stricte à 100 % des <code className="text-[#45D7F4]">\r\n</code>, espaces, tabulations et balises (zéro <code className="text-[#E5B84B]">.trim()</code>).
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          {PAYLOAD_PRESETS.map((preset) => (
            <button
              key={preset.id}
              type="button"
              onClick={() => {
                if (preset.content.includes('\r\n')) {
                  setEnforceCrlfLineEndings(true);
                }
                onChange(preset.content);
                onNotify?.(`Modèle « ${preset.label} » injecté en mode brut.`);
              }}
              className="px-2.5 py-1.5 rounded-md bg-[#151F31] hover:bg-[#1E2B44] border border-[#243147] text-[11px] font-medium text-[#E8EEF5] transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              {preset.label}
            </button>
          ))}
        </div>
      </div>

      {/* Barre d'insertion rapide des 7 tags + CRLF brut + verrou CRLF */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1.5">
          {PAYLOAD_QUICK_TAGS.map((item) => (
            <button
              key={item.tag}
              type="button"
              title={item.hint}
              onClick={() => insertAtCursor(item.tag)}
              className="px-2.5 py-1.5 rounded-md bg-[#070B14] hover:bg-[#151F31] border border-[#243147] hover:border-[#45D7F4]/60 font-mono text-xs text-[#45D7F4] transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              {item.tag}
            </button>
          ))}
          <button
            type="button"
            title="Insérer un vrai retour chariot CRLF (\r\n) au curseur"
            onClick={() => insertAtCursor('\r\n')}
            className="px-2.5 py-1.5 rounded-md bg-[#070B14] hover:bg-[#151F31] border border-[#E5B84B]/40 hover:border-[#E5B84B] font-mono text-xs text-[#E5B84B] transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            + \r\n (CRLF)
          </button>
        </div>

        <button
          type="button"
          onClick={handleToggleCrlfLock}
          title="Empêche le navigateur de convertir vos \r\n en \n lors de la saisie"
          className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border font-mono text-[11px] transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
            enforceCrlfLineEndings
              ? 'bg-[#151F31] border-[#45D7F4]/60 text-[#45D7F4]'
              : 'bg-[#070B14] border-[#243147] text-[#8D9AAF] hover:text-[#F2F6FF]'
          }`}
        >
          <Lock className="w-3 h-3" />
          {enforceCrlfLineEndings ? 'Fins de ligne : \\r\\n (CRLF)' : 'Fins de ligne : \\n (LF)'}
        </button>
      </div>

      {/* Zone de saisie monospace brute */}
      <textarea
        ref={textareaRef}
        rows={6}
        spellCheck={false}
        autoCorrect="off"
        autoCapitalize="off"
        wrap="off"
        value={domDisplayValue}
        onChange={(e) => handleTextareaChange(e.target.value)}
        onPaste={handleRawPaste}
        placeholder="GET /wss [protocol][crlf]Host: [host][crlf]Upgrade: websocket[crlf]Connection: Upgrade[crlf][crlf]"
        className="w-full p-3.5 bg-[#070B14] border border-[#243147] focus:border-[#45D7F4] focus:outline-none rounded-lg font-mono text-xs leading-relaxed text-[#45D7F4] overflow-x-auto whitespace-pre"
      />

      {/* Métriques brutes (texte tabulaire sans pill) + actions Copie / Aperçu / Effacer */}
      <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
        <div className="flex flex-wrap items-center gap-2 text-xs font-mono tabular-nums text-[#8D9AAF]">
          <span>
            <strong className="text-[#F2F6FF]">{metrics.byteLength}</strong> octets
          </span>
          <span aria-hidden="true">·</span>
          <span>
            <strong className="text-[#F2F6FF]">{metrics.charCount}</strong> car.
          </span>
          <span aria-hidden="true">·</span>
          <span>
            CRLF (\r\n) : <strong className="text-[#45D7F4]">{metrics.crlfCount}</strong>
          </span>
          <span aria-hidden="true">·</span>
          <span>
            LF (\n) : <strong className="text-[#F2F6FF]">{metrics.lfOnlyCount}</strong>
          </span>
          <span aria-hidden="true">·</span>
          <span>
            Espaces déb./fin :{' '}
            <strong className="text-[#E5B84B]">
              {metrics.leadingSpaces}/{metrics.trailingSpaces}
            </strong>
          </span>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setShowPreview((v) => !v)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-[#151F31] hover:bg-[#1E2B44] border border-[#243147] text-xs font-medium text-[#E8EEF5] transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            {showPreview ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
            {showPreview ? 'Masquer aperçu' : 'Aperçu brut'}
          </button>
          <button
            type="button"
            onClick={() => void handleCopyRaw()}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-[#151F31] hover:bg-[#1E2B44] border border-[#45D7F4]/40 text-xs font-medium text-[#45D7F4] transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
            {copied ? 'Copié brut' : 'Copier brut'}
          </button>
          <button
            type="button"
            onClick={() => onChange('')}
            title="Vider le payload"
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md bg-[#070B14] hover:bg-[#151F31] border border-[#243147] text-xs text-[#8D9AAF] hover:text-[#F2F6FF] transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            Vider
          </button>
        </div>
      </div>

      {/* Prévisualisation brute (Brut exact vs Caractères de contrôle visibles) */}
      {showPreview && (
        <div className="border-t border-[#243147] pt-3 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-medium text-[#8D9AAF]">
              Prévisualisation brute du Payload
            </span>
            <div className="inline-flex items-center gap-1 p-0.5 rounded-md bg-[#070B14] border border-[#243147]">
              <button
                type="button"
                onClick={() => setPreviewMode('raw')}
                className={`px-2.5 py-1 rounded text-[11px] font-medium transition-colors whitespace-nowrap cursor-pointer ${
                  previewMode === 'raw'
                    ? 'bg-[#151F31] text-[#45D7F4]'
                    : 'text-[#8D9AAF] hover:text-[#F2F6FF]'
                }`}
              >
                Brut exact
              </button>
              <button
                type="button"
                onClick={() => setPreviewMode('escaped')}
                className={`px-2.5 py-1 rounded text-[11px] font-medium transition-colors whitespace-nowrap cursor-pointer ${
                  previewMode === 'escaped'
                    ? 'bg-[#151F31] text-[#E5B84B]'
                    : 'text-[#8D9AAF] hover:text-[#F2F6FF]'
                }`}
              >
                CRLF &amp; espaces visibles
              </button>
            </div>
          </div>

          <pre className="p-3 bg-[#070B14] border border-[#243147] rounded-lg font-mono text-xs text-[#E8EEF5] overflow-x-auto whitespace-pre min-h-[56px]">
            {value.length === 0
              ? '(Payload vide)'
              : previewMode === 'raw'
                ? value
                : metrics.escaped}
          </pre>
        </div>
      )}
    </div>
  );
};
