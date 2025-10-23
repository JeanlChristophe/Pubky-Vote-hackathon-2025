import { PropsWithChildren, createContext, useContext, useEffect, useMemo, useState } from 'react';
import { useAuth } from './AuthContext';
import type { BallotPayload, BallotSessionEvent, Project, ScoreComponent } from '../types/project';
import { enqueueBallot, flushQueue, registerQueueSender } from '../services/cacheQueue';
import { createBallotStorageSender } from '../services/homeserverApi';
import { demoProjects } from '../services/sampleProjects';

interface ProjectContextValue {
  projects: Project[];
  updateProjectScore: (projectId: string, component: ScoreComponent, value: number) => void;
  updateComment: (projectId: string, comment: string) => void;
  updateTags: (projectId: string, tags: string[]) => void;
  submitBallot: () => Promise<void>;
  popularRanking: string[];
  setPopularRanking: (ranking: string[]) => void;
  userProjectId: string | null;
  setUserProjectId: (projectId: string | null) => void;
  hasPendingChanges: boolean;
  lastSubmittedAt: string | null;
}

const ProjectContext = createContext<ProjectContextValue | undefined>(undefined);

const STORAGE_KEY = 'pubky-live-vote:projects';
const RANKING_KEY = 'pubky-live-vote:popular';
const SUBMISSION_KEY = 'pubky-live-vote:last-submission';
const OWN_PROJECT_KEY = 'pubky-live-vote:own-project';

const SCORE_COMPONENTS: ScoreComponent[] = ['complexity', 'creativity', 'readiness', 'presentation', 'feedback'];

type LegacyProject = Project & { readiness?: boolean };

const clampScore = (value: unknown, fallback = 0) => {
  if (typeof value !== 'number' || Number.isNaN(value)) return fallback;
  return Math.min(10, Math.max(0, Math.round(value)));
};

const normalizeProject = (input: LegacyProject): Project => {
  const legacyReadiness = input.readiness === true ? 10 : input.readiness === false ? 0 : undefined;
  const normalizedScores = SCORE_COMPONENTS.reduce((acc, component) => {
    const fallback = component === 'readiness' ? legacyReadiness ?? 0 : 0;
    const rawScores = input.scores as Partial<Record<ScoreComponent, unknown>>;
    acc[component] = clampScore(rawScores?.[component], fallback);
    return acc;
  }, {} as Record<ScoreComponent, number>);

  return {
    id: typeof input.id === 'string' ? input.id : String(input.id ?? ''),
    name: typeof input.name === 'string' ? input.name : String(input.name ?? ''),
    description:
      typeof input.description === 'string' ? input.description : String(input.description ?? ''),
    tags: Array.isArray(input.tags) ? input.tags.map((tag) => String(tag)) : [],
    scores: normalizedScores,
    comment: typeof input.comment === 'string' ? input.comment : undefined,
    userTags: Array.isArray(input.userTags) ? input.userTags.map((tag) => String(tag)) : [],
    teamMembers: Array.isArray(input.teamMembers)
      ? input.teamMembers.map((member) => String(member))
      : undefined,
    aiScore: typeof input.aiScore === 'number' ? input.aiScore : undefined
  } satisfies Project;
};

const loadInitialProjects = () => {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored) {
    try {
      const parsed = JSON.parse(stored) as LegacyProject[];
      if (Array.isArray(parsed)) {
        return parsed.map(normalizeProject);
      }
    } catch (error) {
      console.warn('Failed to parse stored projects, falling back to defaults', error);
    }
  }
  return demoProjects.map(normalizeProject);
};

const buildSubmissionEvent = (
  submittedAt: string,
  session: ReturnType<typeof useAuth>['session'],
  authMethod: ReturnType<typeof useAuth>['authMethod']
): BallotSessionEvent => {
  let publicKey: string | null = null;
  let sessionId: string | null = null;

  if (session) {
    try {
      if (typeof session.info?.publicKey?.z32 === 'function') {
        publicKey = session.info.publicKey.z32();
      }
    } catch (error) {
      console.warn('Unable to read session public key metadata', error);
    }

    if (session.info && 'sessionId' in session.info) {
      sessionId = (session.info as { sessionId?: string | null }).sessionId ?? null;
    }
  }

  const metadata: Record<string, unknown> = {
    authMethod: authMethod ?? null
  };

  if (typeof navigator !== 'undefined') {
    metadata.userAgent = navigator.userAgent;
    metadata.timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  }

  return {
    type: 'ballot_submitted',
    timestamp: submittedAt,
    session: session ? { publicKey, sessionId } : null,
    metadata
  } satisfies BallotSessionEvent;
};

export const ProjectProvider = ({ children }: PropsWithChildren) => {
  const { user, sessionStorage, session, authMethod } = useAuth();
  const [projects, setProjects] = useState<Project[]>(loadInitialProjects);
  const [popularRanking, setPopularRanking] = useState<string[]>(() => {
    const stored = localStorage.getItem(RANKING_KEY);
    if (stored) {
      return JSON.parse(stored) as string[];
    }
    return [];
  });
  const [hasPendingChanges, setPending] = useState(false);
  const [lastSubmittedAt, setLastSubmittedAt] = useState<string | null>(() => localStorage.getItem(SUBMISSION_KEY));
  const [userProjectId, setUserProjectId] = useState<string | null>(() => localStorage.getItem(OWN_PROJECT_KEY));

  useEffect(() => {
    if (!sessionStorage) {
      registerQueueSender(null);
      return;
    }
    const sender = createBallotStorageSender(sessionStorage);
    registerQueueSender(sender);
    void flushQueue(sender);
    return () => {
      registerQueueSender(null);
    };
  }, [sessionStorage]);

  const persistState = (updatedProjects: Project[], updatedRanking: string[]) => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updatedProjects));
    localStorage.setItem(RANKING_KEY, JSON.stringify(updatedRanking));
  };

  const mutateProject = (projectId: string, updater: (project: Project) => Project) => {
    setProjects((current) => {
      const updated = current.map((project) => (project.id === projectId ? updater(project) : project));
      persistState(updated, popularRanking);
      setPending(true);
      return updated;
    });
  };

  const updateProjectScore = (projectId: string, component: ScoreComponent, value: number) => {
    mutateProject(projectId, (project) => ({
      ...project,
      scores: { ...project.scores, [component]: value }
    }));
  };

  const updateComment = (projectId: string, comment: string) => {
    mutateProject(projectId, (project) => ({ ...project, comment }));
  };

  const updateTags = (projectId: string, tags: string[]) => {
    mutateProject(projectId, (project) => ({ ...project, userTags: tags }));
  };

  const submitBallot = async () => {
    if (!user) return;
    if (lastSubmittedAt && !hasPendingChanges) return;
    const submittedAt = new Date().toISOString();
    const submissionEvent = buildSubmissionEvent(submittedAt, session, authMethod);

    const payload: BallotPayload = {
      voterId: user.publicKey,
      submittedAt,
      events: [submissionEvent],
      popularRanking,
      scores: projects.map((project) => ({
        projectId: project.id,
        scores: project.scores,
        comment: project.comment,
        tags: project.userTags
      }))
    };
    enqueueBallot(payload);
    persistState(projects, popularRanking);
    try {
      await flushQueue();
      setPending(false);
      setLastSubmittedAt(payload.submittedAt);
      localStorage.setItem(SUBMISSION_KEY, payload.submittedAt);
    } catch (error) {
      console.warn('Queue flush failed, will retry when online', error);
    }
  };

  const value = useMemo(
    () => ({
      projects,
      updateProjectScore,
      updateComment,
      updateTags,
      submitBallot,
      popularRanking,
      setPopularRanking: (ranking: string[]) => {
        const next = ranking.filter((id, index) => ranking.indexOf(id) === index).slice(0, 5);
        setPopularRanking(next);
        localStorage.setItem(RANKING_KEY, JSON.stringify(next));
        setPending(true);
      },
      userProjectId,
      setUserProjectId: (projectId: string | null) => {
        setUserProjectId(projectId);
        if (projectId) {
          localStorage.setItem(OWN_PROJECT_KEY, projectId);
        } else {
          localStorage.removeItem(OWN_PROJECT_KEY);
        }
        setPending(true);
      },
      hasPendingChanges,
      lastSubmittedAt
    }),
    [projects, popularRanking, hasPendingChanges, lastSubmittedAt, userProjectId]
  );

  return <ProjectContext.Provider value={value}>{children}</ProjectContext.Provider>;
};

export const useProjects = () => {
  const context = useContext(ProjectContext);
  if (!context) throw new Error('useProjects must be used within ProjectProvider');
  return context;
};
