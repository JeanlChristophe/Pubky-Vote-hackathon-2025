import { Fragment, useMemo } from 'react';
import { useProjects } from '../context/ProjectContext';
import { ProjectCard } from './ProjectCard';
import './ProjectList.css';
import './Panel.css';

type ProjectListProps = {
  searchQuery?: string;
};

const normalizeQuery = (query: string) =>
  query
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');

export const ProjectList = ({ searchQuery = '' }: ProjectListProps) => {
  const { projects, updateProjectScore, updateComment, updateTags } = useProjects();
  const normalizedQuery = normalizeQuery(searchQuery);

  const filteredProjects = useMemo(() => {
    if (!normalizedQuery) {
      return projects;
    }

    const terms = normalizedQuery.split(' ');

    return projects.filter((project) => {
      const searchableContent = [
        project.name,
        project.description,
        ...(project.tags ?? []),
        ...(project.userTags ?? []),
        ...(project.teamMembers ?? [])
      ]
        .join(' ')
        .toLowerCase();

      return terms.every((term) => searchableContent.includes(term));
    });
  }, [projects, normalizedQuery]);

  return (
    <div className="panel project-list">
      <header className="panel__header">
        <div>
          <h2>Projects</h2>
          <p className="panel__subtitle">Score projects across the rubric, leave feedback, and apply tags.</p>
        </div>
      </header>
      {filteredProjects.length === 0 ? (
        <p className="project-list__empty" role="status">
          No projects found matching “{searchQuery.trim()}”.
        </p>
      ) : (
        <div className="project-list__grid">
          {filteredProjects.map((project) => (
            <Fragment key={project.id}>
              <ProjectCard
                project={project}
                onScoreChange={updateProjectScore}
                onCommentChange={updateComment}
                onTagsChange={updateTags}
              />
            </Fragment>
          ))}
        </div>
      )}
    </div>
  );
};
