import React from 'react';

export interface ActivityEntry {
    time: number;
    direction: 'up' | 'down' | 'info' | 'error';
    message: string;
}

export function ActivityLog({ activity }: { activity: ActivityEntry[] }) {
    return (
        <section className="panel log">
            <h2>Activity</h2>
            {activity.length === 0 && <p className="crumbs">No activity yet.</p>}
            {activity.map((entry, i) => (
                <div key={`${entry.time}-${i}`} className={`log-entry ${entry.direction}`}>
                    <span className="time">{new Date(entry.time).toLocaleTimeString()}</span>
                    <span className="dir">
                        {entry.direction === 'up'
                            ? '↑'
                            : entry.direction === 'down'
                              ? '↓'
                              : entry.direction === 'error'
                                ? '!'
                                : '·'}
                    </span>
                    <span className="msg">{entry.message}</span>
                </div>
            ))}
        </section>
    );
}
