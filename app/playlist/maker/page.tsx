'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';

export default function PlaylistMakerPage() {
  const [previewCopied, setPreviewCopied] = useState(false);
  const [form, setForm] = useState({
    feedUrl: 'https://feed.homegrownhits.xyz/feed.xml',
    title: 'Homegrown Hits music playlist',
    author: 'ChadF',
    link: 'https://homegrownhits.xyz',
    imageUrl: 'https://bowlafterbowl.com/wp-content/uploads/2023/09/HomegrownHitsArt.png',
    guid: '',
    descriptionHtml: 'Every music reference from Homegrown Hits podcast',
  });
  const [autoLoading, setAutoLoading] = useState(false);
  const [autoError, setAutoError] = useState<string | null>(null);
  const stripTags = (input: string) => input.replace(/<[^>]*>/g, '').trim();
  const toFeedDescription = (input: string) => (input || '').trim();
  const isUuid = (s: unknown): s is string =>
    typeof s === 'string' && /^(?:[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12})$/.test(s);
  const genUuid = (): string =>
    (typeof crypto !== 'undefined' && 'randomUUID' in crypto)
      ? (crypto as any).randomUUID()
      : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => { const r=(Math.random()*16)|0; const v=c==='x'?r:(r&0x3)|0x8; return v.toString(16); });

  // Ensure a valid GUID on first render; prefer feed GUID for default HGH
  const autoRunRef = useRef(false);
  useEffect(() => {
    if (autoRunRef.current) return;
    const isDefaultHGH = form.feedUrl === 'https://feed.homegrownhits.xyz/feed.xml';
    if (isDefaultHGH) {
      autoRunRef.current = true;
      // Try to load feed GUID; fallback to generating UUID
      (async () => {
        try {
          const res = await fetch(`/api/fetch-feed-metadata?feedUrl=${encodeURIComponent(form.feedUrl)}`, { cache: 'no-store' });
          if (res.ok) {
            const json = await res.json();
            const m = json.metadata || {};
            const feedGuid = m.guid;
            if (isUuid(feedGuid)) {
              setForm(f => ({ ...f, guid: feedGuid }));
              return;
            }
          }
        } catch {}
        setForm(f => (isUuid(f.guid) && f.guid ? f : { ...f, guid: genUuid() }));
      })();
    } else if (!isUuid(form.guid)) {
      autoRunRef.current = true;
      setForm(f => (isUuid(f.guid) && f.guid ? f : { ...f, guid: genUuid() }));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const autoFillFromFeed = async () => {
    setAutoLoading(true);
    setAutoError(null);
    try {
      const ac = new AbortController();
      const t = setTimeout(() => ac.abort(), 12000);
      const res = await fetch(`/api/fetch-feed-metadata?feedUrl=${encodeURIComponent(form.feedUrl)}`, { signal: ac.signal, cache: 'no-store' });
      clearTimeout(t);
      if (res.ok) {
        const json = await res.json();
        const m = json.metadata || {};
        setForm(f => ({
          ...f,
          title: m.title || f.title,
          author: m.author || f.author,
          link: m.link || f.link,
          imageUrl: m.imageUrl || f.imageUrl,
          // Only accept feed GUID if it is a UUID; otherwise keep current UUID
          guid: isUuid(m.guid) ? m.guid : f.guid,
          descriptionHtml: f.descriptionHtml || (m.description ? stripTags(m.description) : f.descriptionHtml)
        }));
      } else {
        const err = await res.json().catch(() => ({}));
        setAutoError(err?.error || `Import failed (${res.status})`);
      }
    } catch (e: any) {
      setAutoError(e?.name === 'AbortError' ? 'Timed out loading feed' : 'Failed to load feed');
    } finally {
      setAutoLoading(false);
    }
  };

  // Track selection removed; playlist is built from the source feed as-is

  const [previewXml, setPreviewXml] = useState<string>('');
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);

  const refreshPreview = async () => {
    setPreviewLoading(true);
    setPreviewError(null);
    try {
      const ac = new AbortController();
      const t = setTimeout(() => ac.abort(), 12000);
      const res = await fetch('/api/generate-playlist-rss', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          template: 'minimal',
          feedUrl: form.feedUrl,
          fast: true,
           overrides: { ...form, medium: 'musicL', descriptionHtml: toFeedDescription(form.descriptionHtml) },
        }),
        signal: ac.signal,
        cache: 'no-store',
      });
      clearTimeout(t);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const xml = await res.text();
      setPreviewXml(xml);
    } catch (e) {
      setPreviewError('Failed to load preview');
    } finally {
      setPreviewLoading(false);
    }
  };

  // Selection cleared feature removed

  return (
    <div className="min-h-screen bg-gray-900 text-white">
      <div className="container mx-auto px-4 py-6 space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold">Auto musicL Maker</h1>
            <p className="text-gray-400">Make a musicL playlist from any RSS feed that has V4V music in it</p>
          </div>
          <div className="flex items-center gap-2">
            <Link href="/playlist/index" className="text-blue-400 hover:text-blue-300">← Back to Playlists</Link>
          </div>
        </div>

        {/* Toolbar removed per request */}

        {/* Feed Builder */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 p-4 rounded-lg bg-white/5 border border-white/10">
          <div className="space-y-3">
            <div>
              <label className="block text-sm text-gray-400 mb-1">Source RSS feed URL</label>
              <div className="flex gap-2">
                <input className="flex-1 px-3 py-2 rounded bg-black/40 border border-white/10" value={form.feedUrl} onChange={e=>setForm(f=>({...f, feedUrl:e.target.value}))}/>
                <button
                  onClick={autoFillFromFeed}
                  className="px-3 py-2 rounded bg-white/10 hover:bg-white/20"
                  disabled={autoLoading}
                >{autoLoading? 'Importing…':'Import'}</button>
              </div>
              {autoError && <p className="mt-2 text-sm text-red-400">{autoError}</p>}
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-sm text-gray-400 mb-1">Title</label>
                <input className="w-full px-3 py-2 rounded bg-black/40 border border-white/10" value={form.title} onChange={e=>setForm(f=>({...f, title:e.target.value}))}/>
              </div>
              <div>
                <label className="block text-sm text-gray-400 mb-1">Author</label>
                <input className="w-full px-3 py-2 rounded bg-black/40 border border-white/10" value={form.author} onChange={e=>setForm(f=>({...f, author:e.target.value}))}/>
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-sm text-gray-400 mb-1">Site Link <span className="text-xs text-gray-500 ml-2">(from feed)</span></label>
                <input className="w-full px-3 py-2 rounded bg-black/20 border border-white/10 text-gray-300" value={form.link} readOnly aria-readonly="true"/>
                <p className="mt-1 text-xs text-gray-500">Auto-filled from the feed and locked to link back to the podcaster site.</p>
              </div>
              <div>
                <label className="block text-sm text-gray-400 mb-1">Image URL <span className="text-xs text-gray-500 ml-2">(playlist art)</span></label>
                <input className="w-full px-3 py-2 rounded bg-black/40 border border-white/10" value={form.imageUrl} onChange={e=>setForm(f=>({...f, imageUrl:e.target.value}))}/>
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-1 gap-3">
              <div>
                <label className="block text-sm text-gray-400 mb-1">GUID <span className="text-xs text-gray-500 ml-2">if this is a new playlist click Auto or enter your own new GUID</span></label>
                <div className="flex gap-2">
                  <input
                    className="flex-1 px-3 py-2 rounded bg-black/40 border border-white/10"
                    value={form.guid}
                    onChange={e=>setForm(f=>({...f, guid:e.target.value}))}
                    placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                  />
                  <button
                    type="button"
                    onClick={() => setForm(f => ({ ...f, guid: (typeof crypto !== 'undefined' && 'randomUUID' in crypto) ? crypto.randomUUID() : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => { const r=(Math.random()*16)|0; const v=c==='x'?r:(r&0x3)|0x8; return v.toString(16); }) }))}
                    className="px-3 py-2 rounded bg-white/10 hover:bg-white/20 whitespace-nowrap"
                    title="Auto-generate GUID"
                  >Auto</button>
                  <a
                    href="https://guidgenerator.com/"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="px-3 py-2 rounded bg-white/10 hover:bg-white/20 whitespace-nowrap"
                    title="Open GUID Generator"
                  >Open</a>
                </div>
              </div>
            </div>
          </div>
          <div>
            <label className="block text-sm text-gray-400 mb-1">Description (HTML allowed)</label>
            <textarea className="w-full h-40 px-3 py-2 rounded bg-black/40 border border-white/10" value={form.descriptionHtml} onChange={e=>setForm(f=>({...f, descriptionHtml:e.target.value}))}/>
            {/* Quick Generate (GET) removed */}
          </div>
        </div>

        {/* Feed Preview */}
        <div className="p-4 rounded-lg bg-white/5 border border-white/10 space-y-3">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-xl font-semibold">Feed Preview</h2>
            <div className="flex items-center gap-2">
              <button onClick={refreshPreview} disabled={previewLoading} className="px-3 py-2 text-sm rounded bg-white/10 hover:bg-white/20">
                {previewLoading ? 'Generating…' : 'Refresh Preview'}
              </button>
              <button
                onClick={async()=>{ if(!previewXml) return; await navigator.clipboard.writeText(previewXml); setPreviewCopied(true); setTimeout(()=>setPreviewCopied(false),1500); }}
                disabled={!previewXml}
                className="px-3 py-2 text-sm rounded bg-white/10 hover:bg-white/20 disabled:opacity-40"
              >{previewCopied ? 'Copied!' : 'Copy XML'}</button>
              <button
                onClick={()=>{ if(!previewXml) return; const blob = new Blob([previewXml], {type:'application/rss+xml;charset=utf-8'}); const url = URL.createObjectURL(blob); const a=document.createElement('a'); a.href=url; a.download='playlist.xml'; a.click(); URL.revokeObjectURL(url); }}
                disabled={!previewXml}
                className="px-3 py-2 text-sm rounded bg-white/10 hover:bg-white/20 disabled:opacity-40"
              >Download</button>
            </div>
          </div>
          {previewError && <p className="text-sm text-red-400">{previewError}</p>}
          <div className="rounded bg-black/40 border border-white/10 overflow-hidden">
            <pre className="whitespace-pre-wrap break-words p-3 font-mono text-xs text-gray-200 min-h-[200px] max-h-[400px] overflow-auto">
{previewXml || 'No preview yet. Click “Refresh Preview”.'}
            </pre>
          </div>
          <p className="text-xs text-gray-500">Template: minimal · podcast:medium fixed to musicL</p>
        </div>

        {/* Track picker removed: this tool generates a playlist directly from the source feed */}
      </div>
    </div>
  );
}


