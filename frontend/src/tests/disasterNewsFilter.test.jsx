import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import React from 'react';
import News from '../pages/News';
import { newsAPI } from '../services/api';
import {
  DISASTER_CATEGORIES,
  classifyDisasterArticle,
  isDisasterArticle,
  filterAndPrioritizeDisasterArticles,
  isNerRelated
} from '../utils/disasterNewsFilter';

// Mock AuthContext
vi.mock('../contexts/AuthContext', () => ({
  useAuth: () => ({ user: { role: 'authority' } }),
}));

// Mock newsAPI
vi.mock('../services/api', () => ({
  newsAPI: {
    getAll: vi.fn(),
    refresh: vi.fn(),
  },
}));

describe('STEP 40-NEWS-DISASTER-FILTER — Disaster-Only News Filtering & Categorization', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // =========================================================================
  // Section 1: Pure Classifier Unit Tests (Requirements 1 - 16)
  // =========================================================================
  describe('Disaster Classification & False-Positive Rejection (Unit Logic)', () => {
    it('1. Landslide article -> SHOW (LANDSLIDE)', () => {
      expect(classifyDisasterArticle('Heavy rainfall triggers landslides in Sikkim', 'NH-10 blocked due to mudslide')).toBe(DISASTER_CATEGORIES.LANDSLIDE);
    });

    it('2. Flash flood article -> SHOW (FLASH_FLOOD)', () => {
      expect(classifyDisasterArticle('Flash floods block roads in Arunachal Pradesh', 'Sudden torrent sweeps away culvert')).toBe(DISASTER_CATEGORIES.FLASH_FLOOD);
    });

    it('3. Flood article -> SHOW (FLOOD)', () => {
      expect(classifyDisasterArticle('Authorities issue flood warning after continuous rain', 'Brahmaputra river flows above danger level in Assam')).toBe(DISASTER_CATEGORIES.FLOOD);
    });

    it('4. Avalanche article -> SHOW (AVALANCHE)', () => {
      expect(classifyDisasterArticle('Massive avalanche strikes high-altitude mountain pass', 'Snowslide traps several vehicles')).toBe(DISASTER_CATEGORIES.AVALANCHE);
    });

    it('5. Earthquake article -> SHOW (EARTHQUAKE)', () => {
      expect(classifyDisasterArticle('6.2 magnitude earthquake hits region', 'Tremors felt across multiple districts with epicenter near border')).toBe(DISASTER_CATEGORIES.EARTHQUAKE);
    });

    it('6. Tsunami article -> SHOW (TSUNAMI)', () => {
      expect(classifyDisasterArticle('Tsunami warning issued after undersea earthquake', 'Coastal evacuation advised')).toBe(DISASTER_CATEGORIES.TSUNAMI);
    });

    it('7. Cyclone/storm article -> SHOW (CYCLONE_STORM)', () => {
      expect(classifyDisasterArticle('Severe cyclone makes landfall with gale-force winds', 'Storm surge inundates low-lying coastal areas')).toBe(DISASTER_CATEGORIES.CYCLONE_STORM);
    });

    it('8. Extreme rainfall/cloudburst article -> SHOW (EXTREME_RAINFALL)', () => {
      expect(classifyDisasterArticle('Cloudburst causes sudden deluge and torrent in mountain village', 'Incessant torrential rain triggers emergency')).toBe(DISASTER_CATEGORIES.EXTREME_RAINFALL);
    });

    it('9. Wildfire article -> SHOW (WILDFIRE)', () => {
      expect(classifyDisasterArticle('Forest fire blazes across pine reserve hills', 'Wildfire emergency response teams deployed')).toBe(DISASTER_CATEGORIES.WILDFIRE);
    });

    it('10. Disaster response article -> SHOW (DISASTER_RESPONSE)', () => {
      expect(classifyDisasterArticle('NDRF deploys 5 disaster response teams for rescue operations', 'Relief camps set up for displaced families')).toBe(DISASTER_CATEGORIES.DISASTER_RESPONSE);
    });

    it('11. Cricket article -> HIDE (null)', () => {
      expect(classifyDisasterArticle('India wins cricket match against Australia in thrilling finish', 'Batsmen score centuries in T20 series')).toBeNull();
    });

    it('12. Technology article -> HIDE (null)', () => {
      expect(classifyDisasterArticle('New smartphone launched with 200MP camera and AI features', 'Flagship phone features new fast charging processor')).toBeNull();
    });

    it('13. Business article -> HIDE (null)', () => {
      expect(classifyDisasterArticle('Stock market rises today as Sensex gains 800 points', 'Nifty hits record high amid strong quarterly earnings')).toBeNull();
    });

    it('14. Entertainment article -> HIDE (null)', () => {
      expect(classifyDisasterArticle('Celebrity announces new movie release date on social media', 'Bollywood film trailer launch attended by thousands')).toBeNull();
    });

    it('15. Political article -> HIDE (null)', () => {
      expect(classifyDisasterArticle('Political rally held in city ahead of upcoming polls', 'Opposition party announces manifesto and campaign speeches')).toBeNull();
    });

    it('16. Metaphorical phrases -> HIDE (null)', () => {
      expect(classifyDisasterArticle('Flood of criticism hits government over new policy', 'Opposition leaders protest tax hikes')).toBeNull();
      expect(classifyDisasterArticle('Earthquake in the music industry as top executive resigns', 'Controversy rocks record label')).toBeNull();
      expect(classifyDisasterArticle('Storm in parliament over contentious new budget bill', 'Debate continues in assembly')).toBeNull();
      expect(classifyDisasterArticle('Avalanche of new products unveiled at consumer electronics expo', 'Gadget showcase draws tech enthusiasts')).toBeNull();
      expect(classifyDisasterArticle('Ruling party wins landslide victory in state election', 'Majority gained in key constituencies')).toBeNull();
      expect(classifyDisasterArticle('Firestorm of controversy follows celebrity interview', 'Social media backlash grows')).toBeNull();
    });
  });

  // =========================================================================
  // Section 2: NER Prioritization Logic (Requirement 4)
  // =========================================================================
  describe('NER Disaster Prioritization', () => {
    it('prioritizes NER disaster events over non-NER disaster events', () => {
      const articles = [
        {
          _id: 'global-1',
          title: '6.5 magnitude earthquake hits island nation',
          summary: 'Pacific tremor recorded.',
          publishedAt: new Date('2026-09-08T10:00:00Z')
        },
        {
          _id: 'ner-1',
          title: 'Heavy rainfall triggers landslides in Sikkim',
          summary: 'Roads blocked in North Sikkim district.',
          publishedAt: new Date('2026-09-07T10:00:00Z') // older date, but NER
        },
        {
          _id: 'national-1',
          title: 'Flood warning issued in Gujarat as river swells',
          summary: 'Western state faces monsoon inundation.',
          publishedAt: new Date('2026-09-09T10:00:00Z')
        }
      ];

      const prioritized = filterAndPrioritizeDisasterArticles(articles);
      expect(prioritized.length).toBe(3);
      // NER article is first
      expect(prioritized[0]._id).toBe('ner-1');
      expect(prioritized[0].isNerRelated).toBe(true);
      expect(prioritized[0].disasterCategory).toBe(DISASTER_CATEGORIES.LANDSLIDE);
    });
  });

  // =========================================================================
  // Section 3: Component Integration Tests (Requirements 1 - 19)
  // =========================================================================
  describe('News.jsx Component — Disaster-Only Display & Empty State', () => {
    it('filters mixed articles and ONLY renders disaster-related news', async () => {
      const mixedArticles = [
        {
          _id: 'd-1',
          title: 'Heavy rainfall triggers landslides in Sikkim',
          summary: 'Multiple slope failures reported on highway.',
          url: 'https://news.gov.in/sikkim-landslide',
          source: { name: 'NDMA', type: 'OFFICIAL' },
          publishedAt: new Date().toISOString(),
          location: { state: 'Sikkim' }
        },
        {
          _id: 'd-2',
          title: 'Flash floods block roads in Arunachal Pradesh',
          summary: 'Culverts washed away in Papum Pare.',
          url: 'https://news.gov.in/arunachal-flood',
          source: { name: 'Arunachal SDMA', type: 'OFFICIAL' },
          publishedAt: new Date().toISOString(),
          location: { state: 'Arunachal Pradesh' }
        },
        {
          _id: 'unrelated-1',
          title: 'India wins cricket match in Melbourne',
          summary: 'Team secures victory in T20 series.',
          url: 'https://sports.example.com/cricket',
          source: { name: 'Sports News', type: 'NEWS' },
          publishedAt: new Date().toISOString()
        },
        {
          _id: 'unrelated-2',
          title: 'Flood of criticism over new tech policy',
          summary: 'Controversy erupts in tech forums.',
          url: 'https://tech.example.com/criticism',
          source: { name: 'Tech Daily', type: 'NEWS' },
          publishedAt: new Date().toISOString()
        },
        {
          _id: 'unrelated-3',
          title: 'Stock market rises today with big gains',
          summary: 'Sensex jumps 600 points.',
          url: 'https://finance.example.com/market',
          source: { name: 'Market Times', type: 'NEWS' },
          publishedAt: new Date().toISOString()
        }
      ];

      newsAPI.getAll.mockResolvedValueOnce({
        data: { articles: mixedArticles, total: 5 }
      });

      render(<News />);

      await waitFor(() => {
        expect(screen.queryByText(/Scanning regional news feeds/i)).toBeNull();
      });

      // 1. Genuine disaster articles ARE rendered
      expect(screen.getByText(/Heavy rainfall triggers landslides in Sikkim/i)).toBeTruthy();
      expect(screen.getByText(/Flash floods block roads in Arunachal Pradesh/i)).toBeTruthy();

      // 2. Unrelated/metaphorical articles ARE NOT rendered
      expect(screen.queryByText(/India wins cricket match/i)).toBeNull();
      expect(screen.queryByText(/Flood of criticism over new tech policy/i)).toBeNull();
      expect(screen.queryByText(/Stock market rises today/i)).toBeNull();

      // 3. Tab shows exact count of filtered disaster articles (2 instead of 5)
      expect(screen.getByText(/All Feeds \(2\)/i)).toBeTruthy();
    });

    it('17. displays correct empty state when no disaster articles exist', async () => {
      const nonDisasterArticles = [
        {
          _id: 'cricket-1',
          title: 'Cricket tournament announces schedule',
          summary: 'Match dates revealed for upcoming cup.',
          url: 'https://sports.example.com/1',
          source: { name: 'Sports', type: 'NEWS' },
          publishedAt: new Date().toISOString()
        },
        {
          _id: 'metaphor-1',
          title: 'Avalanche of new products at electronics show',
          summary: 'Consumer tech companies unveil smartphones.',
          url: 'https://tech.example.com/2',
          source: { name: 'Tech', type: 'NEWS' },
          publishedAt: new Date().toISOString()
        }
      ];

      newsAPI.getAll.mockResolvedValueOnce({
        data: { articles: nonDisasterArticles, total: 2 }
      });

      render(<News />);

      await waitFor(() => {
        expect(screen.queryByText(/Scanning regional news feeds/i)).toBeNull();
      });

      // Shows the exact required empty state message
      expect(screen.getByText('No relevant disaster news available right now.')).toBeTruthy();
    });

    it('18 & 19. preserves existing tabs, refresh, and does not trigger extra API calls', async () => {
      const disasterArticles = [
        {
          _id: 'd-1',
          title: 'Heavy rainfall triggers landslides in Sikkim',
          summary: 'Multiple slope failures reported on highway.',
          url: 'https://news.gov.in/sikkim-landslide',
          source: { name: 'NDMA', type: 'OFFICIAL' },
          publishedAt: new Date().toISOString()
        },
        {
          _id: 'd-2',
          title: 'Flash floods submerge low-lying areas in Guwahati',
          summary: 'Waterlogged roads affect traffic.',
          url: 'https://news.example.com/assam-media',
          source: { name: 'Assam Tribune', type: 'NEWS' },
          publishedAt: new Date().toISOString()
        }
      ];

      newsAPI.getAll.mockResolvedValueOnce({
        data: { articles: disasterArticles, total: 2 }
      });

      render(<News />);

      await waitFor(() => {
        expect(screen.queryByText(/Scanning regional news feeds/i)).toBeNull();
      });

      // Exactly 1 API call was made to load articles (no extra API calls)
      expect(newsAPI.getAll).toHaveBeenCalledTimes(1);

      // Verify tabs work
      const officialTab = screen.getByRole('button', { name: /Official Bulletins/i });
      fireEvent.click(officialTab);

      // Only official article is shown
      expect(screen.getByText(/Heavy rainfall triggers landslides in Sikkim/i)).toBeTruthy();
      expect(screen.queryByText(/Flash floods submerge low-lying areas in Guwahati/i)).toBeNull();

      // Media tab
      const mediaTab = screen.getByRole('button', { name: /Media Coverage/i });
      fireEvent.click(mediaTab);

      // Only media article is shown
      expect(screen.queryByText(/Heavy rainfall triggers landslides in Sikkim/i)).toBeNull();
      expect(screen.getByText(/Flash floods submerge low-lying areas in Guwahati/i)).toBeTruthy();

      // Still no extra API calls made during tab switching
      expect(newsAPI.getAll).toHaveBeenCalledTimes(1);
    });
  });
});
