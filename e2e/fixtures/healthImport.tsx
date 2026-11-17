import React from 'react'
import { createRoot } from 'react-dom/client'
import HealthImportSettings from '../../src/components/health/HealthImportSettings'

createRoot(document.getElementById('root')!).render(
  <div className="page" style={{ padding: 16 }}>
    <HealthImportSettings />
  </div>
)
