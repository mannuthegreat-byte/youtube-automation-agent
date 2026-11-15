const fs = require('fs');
const path = require('path');
const axios = require('axios');

// MoneyPrinterTurbo task states (app/models/const.py)
const TASK_STATE_FAILED = -1;
const TASK_STATE_COMPLETE = 1;

const ASPECTS = new Set(['16:9', '9:16', '1:1']);

function moneyPrinterEnabled(env = process.env) {
  return String(env.VIDEO_PROVIDER || '').trim().toLowerCase() === 'moneyprinter';
}

/**
 * Fallback for when no TTS text file is available: flattens the script-writer
 * agent's structured script into plain narration text.
 */
function scriptToNarration(script) {
  if (!script) return '';
  if (typeof script === 'string') return script.trim();
  const parts = [];
  const push = value => {
    if (Array.isArray(value)) value.forEach(push);
    else if (value && typeof value === 'object') Object.values(value).forEach(push);
    else if (typeof value === 'string' && value.trim() && !value.trim().startsWith('[')) parts.push(value.trim());
  };
  push(script.hook?.text);
  push(script.introduction);
  for (const section of script.mainContent?.sections || script.sections || []) {
    push(section?.content ?? section?.steps ?? section?.items);
  }
  push(script.conclusion?.recap);
  push(script.conclusion?.finalThought);
  return parts.join('\n');
}

/**
 * Thin client for the MoneyPrinterTurbo HTTP API. MoneyPrinterTurbo turns the
 * agent's script into a finished video: its own TTS narration, stock footage
 * (Pexels/Pixabay) matched to the script, burned-in subtitles and background music.
 */
class MoneyPrinterClient {
  constructor(options = {}) {
    const env = options.env || process.env;
    this.baseUrl = String(options.baseUrl || env.MONEYPRINTER_API_URL || 'http://127.0.0.1:8080').replace(/\/+$/, '');
    this.apiKey = options.apiKey ?? env.MONEYPRINTER_API_KEY ?? '';
    this.http = options.http || axios;
    this.pollIntervalMs = Math.max(10, Number(options.pollIntervalMs ?? env.MONEYPRINTER_POLL_MS ?? 5000));
    this.timeoutMs = Math.max(1000, Number(options.timeoutMs ?? env.MONEYPRINTER_TIMEOUT_MS ?? 30 * 60 * 1000));
    this.defaults = {
      aspect: env.MONEYPRINTER_VIDEO_ASPECT || env.VIDEO_ASPECT_RATIO || '16:9',
      voiceName: env.MONEYPRINTER_VOICE_NAME || 'en-US-AndrewMultilingualNeural-Male',
      language: env.MONEYPRINTER_VIDEO_LANGUAGE || 'en',
      videoSource: env.MONEYPRINTER_VIDEO_SOURCE || 'pexels',
      clipDuration: Number(env.MONEYPRINTER_CLIP_DURATION || 5),
      subtitles: String(env.MONEYPRINTER_SUBTITLES ?? 'true').toLowerCase() !== 'false',
      bgmType: env.MONEYPRINTER_BGM_TYPE || 'random'
    };
    this.sleep = options.sleep || (ms => new Promise(resolve => setTimeout(resolve, ms)));
  }

  headers() {
    return this.apiKey ? { 'x-api-key': this.apiKey } : {};
  }

  buildRequest({ subject, narration, aspect, terms } = {}) {
    const resolvedAspect = ASPECTS.has(aspect) ? aspect : (ASPECTS.has(this.defaults.aspect) ? this.defaults.aspect : '16:9');
    const cleanTerms = (Array.isArray(terms) ? terms : [])
      .filter(term => typeof term === 'string' && term.trim())
      .map(term => term.trim())
      .slice(0, 10);
    return {
      video_subject: String(subject || 'Untitled video').slice(0, 500),
      video_script: String(narration || ''),
      ...(cleanTerms.length ? { video_terms: cleanTerms } : {}),
      video_aspect: resolvedAspect,
      video_language: this.defaults.language,
      video_source: this.defaults.videoSource,
      video_clip_duration: Math.min(15, Math.max(1, this.defaults.clipDuration || 5)),
      match_materials_to_script: true,
      video_count: 1,
      voice_name: this.defaults.voiceName,
      bgm_type: this.defaults.bgmType,
      subtitle_enabled: this.defaults.subtitles
    };
  }

  async createVideoTask(params) {
    const response = await this.http.post(`${this.baseUrl}/api/v1/videos`, this.buildRequest(params), {
      headers: { ...this.headers(), 'Content-Type': 'application/json' },
      timeout: 60000
    });
    const taskId = response.data?.data?.task_id;
    if (!taskId) throw new Error('MoneyPrinterTurbo did not return a task id');
    return taskId;
  }

  async getTask(taskId) {
    const response = await this.http.get(`${this.baseUrl}/api/v1/tasks/${encodeURIComponent(taskId)}`, {
      headers: this.headers(),
      timeout: 30000
    });
    return response.data?.data || {};
  }

  async waitForTask(taskId) {
    const deadline = Date.now() + this.timeoutMs;
    for (;;) {
      const task = await this.getTask(taskId);
      if (Number(task.state) === TASK_STATE_COMPLETE) return task;
      if (Number(task.state) === TASK_STATE_FAILED) {
        throw new Error(`MoneyPrinterTurbo task ${taskId} failed${task.error ? `: ${String(task.error).slice(0, 300)}` : ''}`);
      }
      if (Date.now() >= deadline) throw new Error(`MoneyPrinterTurbo task ${taskId} timed out after ${Math.round(this.timeoutMs / 1000)}s`);
      await this.sleep(this.pollIntervalMs);
    }
  }

  resolveUrl(fileUrl) {
    if (/^https?:\/\//i.test(fileUrl)) return fileUrl;
    return `${this.baseUrl}/${String(fileUrl).replace(/^\/+/, '')}`;
  }

  async download(fileUrl, outputPath) {
    await fs.promises.mkdir(path.dirname(outputPath), { recursive: true });
    const response = await this.http.get(this.resolveUrl(fileUrl), {
      headers: this.headers(),
      responseType: 'stream',
      timeout: 10 * 60 * 1000
    });
    await new Promise((resolve, reject) => {
      const writer = fs.createWriteStream(outputPath);
      response.data.on('error', reject);
      writer.on('error', reject);
      writer.on('finish', resolve);
      response.data.pipe(writer);
    });
    return outputPath;
  }

  /**
   * Renders a full video and saves it to outputPath.
   * Returns { path, taskId, task }.
   */
  async renderVideo({ subject, narration, aspect, terms, outputPath }) {
    if (!String(narration || '').trim()) throw new Error('MoneyPrinterTurbo needs narration text from the script');
    const taskId = await this.createVideoTask({ subject, narration, aspect, terms });
    const task = await this.waitForTask(taskId);
    const videoUrl = (task.videos || task.combined_videos || [])[0];
    if (!videoUrl) throw new Error(`MoneyPrinterTurbo task ${taskId} completed without a video`);
    await this.download(videoUrl, outputPath);
    return { path: outputPath, taskId, task };
  }

  async ping() {
    const response = await this.http.get(`${this.baseUrl}/ping`, { headers: this.headers(), timeout: 10000 });
    return response.status === 200;
  }
}

module.exports = { MoneyPrinterClient, moneyPrinterEnabled, scriptToNarration };
