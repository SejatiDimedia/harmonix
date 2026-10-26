export function formatSQL(sql?: string): string {
  if (!sql) return '';
  let s = sql.trim().replace(/\s+/g, ' ');
  s = s.replace(/\b(SELECT|FROM|WHERE|GROUP BY|HAVING|ORDER BY|LIMIT|OFFSET)\b/gi, '\n$1');
  s = s.replace(/\b(LEFT JOIN|RIGHT JOIN|INNER JOIN|FULL JOIN|CROSS JOIN|JOIN)\b/gi, '\n  $1');
  s = s.replace(/\b(AND|OR)\b/gi, '\n    $1');
  return s.trim();
}

export function formatSessionDate(isoStr?: string): string {
  if (!isoStr) return '';
  try {
    const d = new Date(isoStr);
    const now = new Date();
    const isToday = d.toDateString() === now.toDateString();
    if (isToday) {
      return d.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
    }
    return d.toLocaleDateString('id-ID', { day: 'numeric', month: 'short' });
  } catch {
    return '';
  }
}

export function formatModelNameShort(modelId?: string): string {
  if (!modelId) return '';
  if (modelId.includes('gpt-oss-120b')) return 'GPT-OSS 120B';
  if (modelId.includes('gpt-oss-20b')) return 'GPT-OSS 20B';
  if (modelId.includes('qwen3.8-27b')) return 'Qwen 3.8 27B';
  if (modelId.includes('nemotron')) return 'Nemotron 3.5 Free';
  if (modelId.includes('gemma')) return 'Gemma Free';
  if (modelId.includes('qwen2.5-coder')) return 'Qwen 2.5 7B';
  if (modelId.includes('llama-3.3-70b')) return 'Llama 3.3 70B';
  if (modelId.includes('llama-3.1-8b')) return 'Llama 3.1 8B';
  if (modelId.includes('gemini-2.5-flash')) return 'Gemini 2.5 Flash';
  if (modelId.includes('gemini-1.5-flash')) return 'Gemini 1.5 Flash';
  if (modelId.includes('claude-3-7')) return 'Claude 3.7 Sonnet';
  if (modelId.includes('claude-3-5')) return 'Claude 3.5 Sonnet';
  if (modelId.includes('deepseek-r1')) return 'DeepSeek R1';
  if (modelId.includes('gpt-4o')) return 'GPT-4o';
  const parts = modelId.split('/');
  return parts[parts.length - 1];
}

export function escapeHtml(str?: any): string {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
