import { useEffect, useMemo, useState } from 'react';
import { ArrowRight, CheckCircle2, ChevronDown, CircleAlert, Globe2, Layers3, LoaderCircle, Search, Sparkles, Wrench, X } from 'lucide-react';
import { API_ENDPOINT } from './agent';
import type { Provider } from './agent';
type CatalogModel = {
  id: string; name: string; providerId: string; provider: string; family: string; description: string;
  context: number | null; inputCost: number | null; outputCost: number | null;
  reasoning: boolean; tools: boolean; vision: boolean; openWeights: boolean; updated: string;
};
type CatalogResult = {
  ok: boolean; status: string; providerTotal: number; catalogTotal: number; total: number;
  fetchedAt: number; stale: boolean;
  models: CatalogModel[]; providers: Array<{ id: string; name: string; count: number }>;
};
const supported = new Set(['openai', 'google', 'anthropic', 'openrouter', 'deepseek', 'groq', 'mistral', 'xai']);
const formatNumber = (n: number) => new Intl.NumberFormat('es-EC').format(n);
const toPrice = (n: number | null) => n == null ? 'Sin dato' : '$' + Number(n.toFixed(3)).toLocaleString('en-US',{maximumFractionDigits:3});
export default function ModelFinder({ onConnect }: { onConnect: (p: Provider) => void }) {
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const [provider, setProvider] = useState('');
  const [sort, setSort] = useState('latest');
  const [tools, setTools] = useState(false);
  const [reasoning, setReasoning] = useState(false);
  const [vision, setVision] = useState(false);
  const [offset, setOffset] = useState(0);
  const [result, setResult] = useState<CatalogResult | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState(true);
  useEffect(() => {
    const timer = setTimeout(() => { setDebounced(query.trim()); setOffset(0); }, 300);
    return () => clearTimeout(timer);
  }, [query]);
  useEffect(() => { setOffset(0); }, [provider, sort, tools, reasoning, vision]);
  useEffect(() => {
    const controller = new AbortController();
    const url = new URL(API_ENDPOINT + '/api/catalog');
    if (debounced) url.searchParams.set('q', debounced);
    if (provider) url.searchParams.set('provider', provider);
    url.searchParams.set('sort', sort);
    url.searchParams.set('limit', '24');
    url.searchParams.set('offset', String(offset));
    if (tools) url.searchParams.set('tools','true');
    if (reasoning) url.searchParams.set('reasoning','true');
    if (vision) url.searchParams.set('vision','true');
    setLoading(true); setError('');
    fetch(url.toString(),{signal: controller.signal})
      .then(async response => {
        const data = await response.json();
        if (!response.ok || !data.ok) throw new Error(data.error || 'Catálogo no disponible');
        return data as CatalogResult;
      })
      .then(setResult)
      .catch(e => { if (e.name !== 'AbortError') setError(String(e.message || 'No se pudieron cargar los modelos')); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [debounced, provider, sort, tools, reasoning, vision, offset]);
  const current = result?.models || [];
  const canMore = !!result && offset + current.length < result.total;
  const heading = useMemo(() => result ? formatNumber(result.catalogTotal) + ' modelos · ' + result.providerTotal + ' proveedores' : 'Catálogo abierto de modelos', [result]);
  return <section className="model-finder" aria-label="Explorar modelos LLM">
    <div className="model-finder-heading"><div className="finder-heading-icon"><Globe2 size={20}/></div>
      <div><strong>Explorar todos los modelos</strong><span>{heading}</span></div>
      <button className="finder-toggle" onClick={() => setExpanded(p=>!p)} aria-expanded={expanded}>{expanded ? 'Contraer' : 'Explorar catálogo'} <ChevronDown className={expanded?'rotate':''} size={15}/></button>
    </div>
    <div className="finder-search"><Search size={17}/><input aria-label="Buscar modelos de IA" value={query} onFocus={() => setExpanded(true)} onChange={e=>setQuery(e.target.value)} placeholder="Busca Claude, Gemini, Llama, Qwen, DeepSeek, GPT, Mistral…"/>{query && <button aria-label="Limpiar búsqueda" onClick={()=>setQuery('')}><X size={16}/></button>}</div>
    {expanded && <>
      <div className="finder-filters">
        <label>Proveedor<select aria-label="Filtrar por proveedor" value={provider} onChange={e=>setProvider(e.target.value)}><option value="">Todos los proveedores</option>{(result?.providers||[]).map(p=><option value={p.id} key={p.id}>{p.name} ({p.count})</option>)}</select></label>
        <label>Ordenar<select aria-label="Ordenar modelos" value={sort} onChange={e=>setSort(e.target.value)}><option value="latest">Actualización más reciente</option><option value="price">Menor costo de entrada</option><option value="context">Mayor contexto</option><option value="name">Nombre</option></select></label>
      </div>
      <div className="finder-capabilities"><button className={reasoning?'filter-on':''} onClick={()=>setReasoning(!reasoning)}><Sparkles size={13}/> Razonamiento</button><button className={tools?'filter-on':''} onClick={()=>setTools(!tools)}><Wrench size={13}/> Herramientas</button><button className={vision?'filter-on':''} onClick={()=>setVision(!vision)}><Layers3 size={13}/> Visión</button></div>
      <div className="finder-result-count"><span>{loading ? 'Actualizando catálogo…' : result ? formatNumber(result.total) + ' coincidencias' : 'Buscando…'}</span><span>Fuente: <a href="https://models.dev/" target="_blank" rel="noopener noreferrer">Models.dev</a></span></div>
      {loading && !result && <div className="finder-loading"><LoaderCircle className="spin" size={19}/> Consultando el índice abierto…</div>}
      {error && <div className="finder-error"><CircleAlert size={16}/>{error}</div>}
      <div className="finder-results">
        {current.map((m,i) => <article key={m.providerId+'/'+m.id+'-'+i} className="finder-model">
          <div className="finder-model-title"><span>{m.name}</span><span className="model-provider">{m.provider}</span></div>
          <div className="finder-id">{m.id}</div>
          {m.description && <p>{m.description}</p>}
          <div className="model-specs"><span>Contexto: {m.context==null?'—':formatNumber(m.context)}</span>
            {m.reasoning && <span><Sparkles size={11}/> Razonamiento</span>}
            {m.tools && <span><Wrench size={11}/> Tools</span>}
            {m.vision && <span>Visión</span>}
            {m.openWeights && <span>Código abierto*</span>}
          </div>
          <div className="model-footer"><span>Entrada: {toPrice(m.inputCost)}/M · Salida: {toPrice(m.outputCost)}/M</span>
            {supported.has(m.providerId) ?
              <button onClick={()=>onConnect(m.providerId as Provider)}>Conectar proveedor <ArrowRight size={13}/></button> :
              <a href={'https://models.dev/providers/'+encodeURIComponent(m.providerId)+'/'} target="_blank" rel="noopener noreferrer">Detalles del proveedor <ArrowRight size={13}/></a>}
          </div>
        </article>)}
        {!loading && !error && result?.models.length===0 && <div className="finder-empty">No se encontraron modelos con estos filtros. Prueba otro término.</div>}
      </div>
      {result && result.total > 24 && <div className="finder-pagination"><button disabled={!offset || loading} onClick={()=>setOffset(Math.max(0,offset-24))}>Anterior</button><span>{formatNumber(offset+1)}–{formatNumber(Math.min(result.total,offset+24))} de {formatNumber(result.total)}</span><button disabled={!canMore || loading} onClick={()=>setOffset(offset+24)}>Siguiente <ArrowRight size={13}/></button></div>}
      <p className="finder-disclaimer"><CheckCircle2 size={13}/> El catálogo muestra disponibilidad pública y precios aproximados por millón de tokens cuando están publicados. Una cuenta o API autorizada es necesaria para usar cada modelo. Los modelos de otros proveedores no se ejecutan automáticamente desde Core.</p>
    </>}
  </section>;
}
