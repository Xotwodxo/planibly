import { NavLink } from 'react-router-dom';

import { Icon, type IconName } from './Icon';

const destinations: readonly { label: string; path: string; icon: IconName }[] = [
  { label: 'Home', path: '/', icon: 'home' },
  { label: 'Plan', path: '/plan', icon: 'plan' },
  { label: 'Calendar', path: '/calendar', icon: 'calendar' },
  { label: 'Lists', path: '/lists', icon: 'lists' },
  { label: 'Insights', path: '/insights', icon: 'insights' },
];

type AppNavigationProps = {
  layout: 'side' | 'bottom';
};

export function AppNavigation({ layout }: AppNavigationProps) {
  return (
    <div className={`navigation-items navigation-items--${layout}`}>
      {destinations.map(({ label, path, icon }) => (
        <NavLink
          key={path}
          className={({ isActive }) => `navigation-link${isActive ? ' is-active' : ''}`}
          end={path === '/'}
          to={path}
        >
          <Icon name={icon} />
          <span>{label}</span>
        </NavLink>
      ))}
    </div>
  );
}
