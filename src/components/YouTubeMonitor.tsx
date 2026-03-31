import React, { useEffect, useRef, useState } from 'react';
import { useSound } from '../hooks/useSound';

interface YtAlert {
  id: string;
  channelId: string;
  channelName: string;
  taskName: string;
  videoId: string;
  videoTitle: string;
  videoUrl: string;
  detectedAt: string;
  timeStr: string;
}

const YT_CHANNELS = [
  {
    id: 'UCAgu5EJBK_HkeQE9KbnzqyA',
    name: 'LEARNING CAPSULES - HARSHAL AGRAWAL',
    taskName: 'Quant YT class',
    subject: 'Quant'
  },
  {
    id: 'UCx2bCaJoAeRb43M24DYvGfg',
    name: 'Studyniti - Study with Smriti',
    taskName: 'Reasoning YT class',
    subject: 'Reasoning'
  }
];

export function YouTubeMonitor({ onAlert }: { onAlert: (alert: YtAlert) => void }) {
  const { playBeep } = useSound();
  const seenIdsRef = useRef<Set<string>>(new Set());
  const initialLoadRef = useRef(true);

  const parseYtRss = (xml: string) => {
    const parser = new DOMParser();
    const doc = parser.parseFromString(xml, 'text/xml');
    const entries = doc.querySelectorAll('entry');
    const videos: any[] = [];

    entries.forEach(entry => {
      const videoId = entry.querySelector('videoId')?.textContent;
      const title = entry.querySelector('title')?.textContent;
      const link = entry.querySelector('link')?.getAttribute('href');
      if (videoId && title) {
        videos.push({
          id: videoId,
          title: title,
          url: link || `https://www.youtube.com/watch?v=${videoId}`
        });
      }
    });
    return videos;
  };

  const checkYouTube = async () => {
    for (const ch of YT_CHANNELS) {
      try {
        const rssUrl = `https://www.youtube.com/feeds/videos.xml?channel_id=${ch.id}`;
        // Using allorigins proxy to bypass CORS in browser
        const proxyUrl = `https://api.allorigins.win/get?url=${encodeURIComponent(rssUrl)}`;
        
        const res = await fetch(proxyUrl);
        if (!res.ok) continue;
        const data = await res.json();
        const xml = data.contents;
        const videos = parseYtRss(xml);

        if (videos.length === 0) continue;

        if (initialLoadRef.current) {
          videos.forEach(v => seenIdsRef.current.add(v.id));
          continue;
        }

        videos.forEach(v => {
          if (!seenIdsRef.current.has(v.id)) {
            seenIdsRef.current.add(v.id);
            const now = new Date();
            const timeStr = now.getHours().toString().padStart(2, '0') + ':' + now.getMinutes().toString().padStart(2, '0');
            
            const alert: YtAlert = {
              id: `yt-${v.id}`,
              channelId: ch.id,
              channelName: ch.name,
              taskName: ch.taskName,
              videoId: v.id,
              videoTitle: v.title,
              videoUrl: v.url,
              detectedAt: now.toISOString(),
              timeStr: timeStr
            };
            
            playBeep(3);
            onAlert(alert);
          }
        });
      } catch (e) {
        console.error(`YouTube monitor error for ${ch.name}:`, e);
      }
    }
    initialLoadRef.current = false;
  };

  useEffect(() => {
    checkYouTube();
    const interval = setInterval(checkYouTube, 15 * 60 * 1000); // Check every 15 minutes
    return () => clearInterval(interval);
  }, []);

  return null; // This is a headless component
}
