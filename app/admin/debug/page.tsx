'use client';

import { useState, useEffect } from 'react';
import { RefreshCw, AlertTriangle, CheckCircle, XCircle, Info } from 'lucide-react';

interface HealthCheck {
  service: string;
  status: 'healthy' | 'warning' | 'critical';
  message: string;
  responseTime?: number;
  details?: any;
}

interface MonitoringSummary {
  totalLogs: number;
  errorCount: number;
  warningCount: number;
  infoCount: number;
  recurringErrors: number;
  categories: string[];
}

export default function AdminDebugPage() {
  const [healthChecks, setHealthChecks] = useState<HealthCheck[]>([]);
  const [monitoringSummary, setMonitoringSummary] = useState<MonitoringSummary | null>(null);
  const [recurringErrors, setRecurringErrors] = useState<Array<{ pattern: string; count: number }>>([]);
  const [loading, setLoading] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<string>('');

  const fetchHealthData = async () => {
    setLoading(true);
    try {
      // Fetch health checks
      const healthResponse = await fetch('/api/health?detailed=true');
      const healthData = await healthResponse.json();
      setHealthChecks(healthData.checks || []);

      // Fetch monitoring data
      const monitoringResponse = await fetch('/api/admin/monitoring?type=summary');
      const monitoringData = await monitoringResponse.json();
      setMonitoringSummary(monitoringData.summary);
      setRecurringErrors(monitoringData.recurringErrors || []);

      setLastUpdated(new Date().toLocaleTimeString());
    } catch (error) {
      console.error('Failed to fetch debug data:', error);
    } finally {
      setLoading(false);
    }
  };

  const clearCache = async (type: string = 'all') => {
    try {
      const response = await fetch(`/api/admin/clear-cache?type=${type}`, { method: 'POST' });
      const data = await response.json();
      console.log('Cache cleared:', data);
      // Refresh data after clearing cache
      setTimeout(fetchHealthData, 1000);
    } catch (error) {
      console.error('Failed to clear cache:', error);
    }
  };

  useEffect(() => {
    fetchHealthData();
  }, []);

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'healthy': return 'text-green-600 bg-green-100';
      case 'warning': return 'text-yellow-600 bg-yellow-100';
      case 'critical': return 'text-red-600 bg-red-100';
      default: return 'text-gray-600 bg-gray-100';
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'healthy': return <CheckCircle className="w-4 h-4" />;
      case 'warning': return <AlertTriangle className="w-4 h-4" />;
      case 'critical': return <XCircle className="w-4 h-4" />;
      default: return <Info className="w-4 h-4" />;
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 p-8">
      <div className="max-w-6xl mx-auto">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900 mb-4">Admin Debug Dashboard</h1>
          <div className="flex gap-4">
            <button
              onClick={fetchHealthData}
              disabled={loading}
              className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
              Refresh Data
            </button>
            <button
              onClick={() => clearCache('all')}
              className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700"
            >
              Clear All Caches
            </button>
            <button
              onClick={() => clearCache('data')}
              className="px-4 py-2 bg-yellow-600 text-white rounded-lg hover:bg-yellow-700"
            >
              Clear Data Cache
            </button>
          </div>
          {lastUpdated && (
            <p className="text-sm text-gray-500 mt-2">Last updated: {lastUpdated}</p>
          )}
        </div>

        {/* Health Checks */}
        <div className="bg-white rounded-lg shadow mb-8">
          <div className="p-6 border-b">
            <h2 className="text-xl font-semibold text-gray-900">System Health Checks</h2>
          </div>
          <div className="p-6">
            <div className="grid gap-4">
              {healthChecks.map((check, index) => (
                <div key={index} className="flex items-center justify-between p-4 border rounded-lg">
                  <div className="flex items-center gap-3">
                    <div className={`p-2 rounded-full ${getStatusColor(check.status)}`}>
                      {getStatusIcon(check.status)}
                    </div>
                    <div>
                      <h3 className="font-medium text-gray-900">{check.service}</h3>
                      <p className="text-sm text-gray-600">{check.message}</p>
                    </div>
                  </div>
                  <div className="text-right">
                    {check.responseTime && (
                      <p className="text-sm text-gray-500">{check.responseTime}ms</p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Monitoring Summary */}
        {monitoringSummary && (
          <div className="bg-white rounded-lg shadow mb-8">
            <div className="p-6 border-b">
              <h2 className="text-xl font-semibold text-gray-900">Monitoring Summary</h2>
            </div>
            <div className="p-6">
              <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                <div className="text-center">
                  <div className="text-2xl font-bold text-blue-600">{monitoringSummary.totalLogs}</div>
                  <div className="text-sm text-gray-600">Total Logs</div>
                </div>
                <div className="text-center">
                  <div className="text-2xl font-bold text-red-600">{monitoringSummary.errorCount}</div>
                  <div className="text-sm text-gray-600">Errors</div>
                </div>
                <div className="text-center">
                  <div className="text-2xl font-bold text-yellow-600">{monitoringSummary.warningCount}</div>
                  <div className="text-sm text-gray-600">Warnings</div>
                </div>
                <div className="text-center">
                  <div className="text-2xl font-bold text-green-600">{monitoringSummary.infoCount}</div>
                  <div className="text-sm text-gray-600">Info</div>
                </div>
                <div className="text-center">
                  <div className="text-2xl font-bold text-purple-600">{monitoringSummary.recurringErrors}</div>
                  <div className="text-sm text-gray-600">Recurring Errors</div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Recurring Errors */}
        {recurringErrors.length > 0 && (
          <div className="bg-white rounded-lg shadow">
            <div className="p-6 border-b">
              <h2 className="text-xl font-semibold text-gray-900">Recurring Error Patterns</h2>
              <p className="text-sm text-gray-600">Issues that occurred multiple times - these may indicate recurring problems</p>
            </div>
            <div className="p-6">
              <div className="space-y-3">
                {recurringErrors.map((error, index) => (
                  <div key={index} className="flex items-center justify-between p-3 bg-red-50 border border-red-200 rounded-lg">
                    <div className="flex-1">
                      <code className="text-sm text-red-800">{error.pattern}</code>
                    </div>
                    <div className="ml-4">
                      <span className="px-2 py-1 bg-red-600 text-white text-xs rounded-full">
                        {error.count} times
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Quick Actions */}
        <div className="bg-white rounded-lg shadow mt-8">
          <div className="p-6 border-b">
            <h2 className="text-xl font-semibold text-gray-900">Quick Actions</h2>
          </div>
          <div className="p-6">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <a
                href="/api/health?detailed=true"
                target="_blank"
                className="p-4 border rounded-lg hover:bg-gray-50 text-center"
              >
                <h3 className="font-medium text-gray-900">View Raw Health Data</h3>
                <p className="text-sm text-gray-600">Detailed health check JSON</p>
              </a>
              <a
                href="/api/admin/monitoring?type=logs&limit=50"
                target="_blank"
                className="p-4 border rounded-lg hover:bg-gray-50 text-center"
              >
                <h3 className="font-medium text-gray-900">View Recent Logs</h3>
                <p className="text-sm text-gray-600">Last 50 log entries</p>
              </a>
              <a
                href="/api/parsed-feeds"
                target="_blank"
                className="p-4 border rounded-lg hover:bg-gray-50 text-center"
              >
                <h3 className="font-medium text-gray-900">View Parsed Feeds</h3>
                <p className="text-sm text-gray-600">Raw feeds data with validation</p>
              </a>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}