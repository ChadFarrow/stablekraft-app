'use client';

import React, { useState, useEffect } from 'react';
import { useBitcoinConnect } from '@/components/Lightning/BitcoinConnectProvider';
import { LIGHTNING_CONFIG } from '@/lib/lightning/config';
import { LNURLService } from '@/lib/lightning/lnurl';
import { Zap, Send, CheckCircle, XCircle, AlertCircle, Wallet, TestTube } from 'lucide-react';

interface TestResult {
  test: string;
  status: 'pending' | 'success' | 'error';
  message: string;
  details?: any;
}

export default function LightningTestDashboard() {
  const { isConnected, connect, sendPayment, sendKeysend, provider } = useBitcoinConnect();
  const [testResults, setTestResults] = useState<TestResult[]>([]);
  const [isRunningTests, setIsRunningTests] = useState(false);
  const [customAmount, setCustomAmount] = useState(21);
  const [customMessage, setCustomMessage] = useState('Test boost from FUCKIT Music');

  const addTestResult = (test: string, status: TestResult['status'], message: string, details?: any) => {
    setTestResults(prev => [...prev, { test, status, message, details }]);
  };

  const clearResults = () => {
    setTestResults([]);
  };

  const runAllTests = async () => {
    setIsRunningTests(true);
    clearResults();

    // Test 1: Configuration Check
    addTestResult('Configuration', 'pending', 'Checking Lightning configuration...');
    try {
      const config = {
        network: LIGHTNING_CONFIG.network,
        nodePubkey: LIGHTNING_CONFIG.platform.nodePublicKey,
        nwcRelay: LIGHTNING_CONFIG.nwc.relayUrl,
      };
      
      if (!config.nodePubkey) {
        addTestResult('Configuration', 'error', 'Platform Node Pubkey not configured');
      } else {
        addTestResult('Configuration', 'success', 'Configuration looks good', config);
      }
    } catch (error) {
      addTestResult('Configuration', 'error', `Configuration error: ${error}`);
    }

    // Test 2: Wallet Connection
    addTestResult('Wallet Connection', 'pending', 'Testing wallet connection...');
    try {
      if (!isConnected) {
        await connect();
      }
      
      if (isConnected && provider) {
        addTestResult('Wallet Connection', 'success', 'Wallet connected successfully', {
          providerType: provider.constructor.name,
          methods: Object.keys(provider)
        });
      } else {
        addTestResult('Wallet Connection', 'error', 'Failed to connect wallet');
      }
    } catch (error) {
      addTestResult('Wallet Connection', 'error', `Connection error: ${error}`);
    }

    // Test 3: LNURL Service
    addTestResult('LNURL Service', 'pending', 'Testing LNURL service...');
    try {
      // Test with a known Lightning Address
      const testAddress = 'chadf@getalby.com';
      const payParams = await LNURLService.resolveLightningAddress(testAddress);
      addTestResult('LNURL Service', 'success', 'LNURL service working', {
        callback: payParams.callback,
        minSendable: payParams.minSendable,
        maxSendable: payParams.maxSendable
      });
    } catch (error) {
      addTestResult('LNURL Service', 'error', `LNURL error: ${error}`);
    }

    // Test 4: Payment Test (if wallet connected)
    if (isConnected && provider) {
      addTestResult('Payment Test', 'pending', 'Testing payment functionality...');
      try {
        // Test with a small amount
        const testAmount = 1; // 1 satoshi for testing
        
        if (LIGHTNING_CONFIG.platform.nodePublicKey) {
          const result = await sendKeysend(LIGHTNING_CONFIG.platform.nodePublicKey, testAmount, 'Test payment');
          
          if (result.preimage) {
            addTestResult('Payment Test', 'success', 'Payment test successful!', {
              amount: testAmount,
              preimage: result.preimage
            });
          } else {
            addTestResult('Payment Test', 'error', `Payment failed: ${result.error}`);
          }
        } else {
          addTestResult('Payment Test', 'error', 'No platform node pubkey configured for testing');
        }
      } catch (error) {
        addTestResult('Payment Test', 'error', `Payment test error: ${error}`);
      }
    } else {
      addTestResult('Payment Test', 'error', 'Skipped - no wallet connected');
    }

    setIsRunningTests(false);
  };

  const testCustomBoost = async () => {
    if (!isConnected) {
      addTestResult('Custom Boost', 'error', 'Please connect wallet first');
      return;
    }

    addTestResult('Custom Boost', 'pending', `Sending ${customAmount} sats boost...`);
    
    try {
      if (LIGHTNING_CONFIG.platform.nodePublicKey) {
        const result = await sendKeysend(LIGHTNING_CONFIG.platform.nodePublicKey, customAmount, customMessage);
        
        if (result.preimage) {
          addTestResult('Custom Boost', 'success', 'Custom boost sent successfully!', {
            amount: customAmount,
            message: customMessage,
            preimage: result.preimage
          });
        } else {
          addTestResult('Custom Boost', 'error', `Boost failed: ${result.error}`);
        }
      } else {
        addTestResult('Custom Boost', 'error', 'No platform node pubkey configured');
      }
    } catch (error) {
      addTestResult('Custom Boost', 'error', `Boost error: ${error}`);
    }
  };

  const getStatusIcon = (status: TestResult['status']) => {
    switch (status) {
      case 'success':
        return <CheckCircle className="w-4 h-4 text-green-400" />;
      case 'error':
        return <XCircle className="w-4 h-4 text-red-400" />;
      case 'pending':
        return <AlertCircle className="w-4 h-4 text-yellow-400 animate-pulse" />;
      default:
        return null;
    }
  };

  return (
    <div className="max-w-4xl mx-auto p-6">
      <div className="bg-gray-900 rounded-lg p-6">
        <div className="flex items-center gap-3 mb-6">
          <TestTube className="w-6 h-6 text-blue-400" />
          <h1 className="text-2xl font-bold text-white">Lightning Integration Test Dashboard</h1>
        </div>

        {/* Connection Status */}
        <div className="mb-6 p-4 bg-gray-800 rounded-lg">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Wallet className="w-5 h-5 text-gray-400" />
              <span className="text-white font-medium">Wallet Status:</span>
              <span className={`px-3 py-1 rounded-full text-sm ${
                isConnected 
                  ? 'bg-green-500/20 text-green-400' 
                  : 'bg-red-500/20 text-red-400'
              }`}>
                {isConnected ? 'Connected' : 'Not Connected'}
              </span>
            </div>
            {!isConnected && (
              <button
                onClick={connect}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors"
              >
                Connect Wallet
              </button>
            )}
          </div>
        </div>

        {/* Test Controls */}
        <div className="mb-6 flex gap-4">
          <button
            onClick={runAllTests}
            disabled={isRunningTests}
            className="flex items-center gap-2 px-4 py-2 bg-green-600 hover:bg-green-700 disabled:bg-gray-600 text-white rounded-lg transition-colors"
          >
            <Zap className="w-4 h-4" />
            {isRunningTests ? 'Running Tests...' : 'Run All Tests'}
          </button>
          
          <button
            onClick={clearResults}
            className="px-4 py-2 bg-gray-600 hover:bg-gray-700 text-white rounded-lg transition-colors"
          >
            Clear Results
          </button>
        </div>

        {/* Custom Boost Test */}
        <div className="mb-6 p-4 bg-gray-800 rounded-lg">
          <h3 className="text-white font-semibold mb-3">Custom Boost Test</h3>
          <div className="flex gap-4 items-end">
            <div>
              <label className="block text-sm text-gray-400 mb-1">Amount (sats)</label>
              <input
                type="number"
                value={customAmount}
                onChange={(e) => setCustomAmount(parseInt(e.target.value) || 21)}
                className="w-24 px-3 py-2 bg-gray-700 text-white rounded-lg border border-gray-600"
                min="1"
                max="100000"
              />
            </div>
            <div className="flex-1">
              <label className="block text-sm text-gray-400 mb-1">Message</label>
              <input
                type="text"
                value={customMessage}
                onChange={(e) => setCustomMessage(e.target.value)}
                className="w-full px-3 py-2 bg-gray-700 text-white rounded-lg border border-gray-600"
                placeholder="Test boost message..."
              />
            </div>
            <button
              onClick={testCustomBoost}
              disabled={!isConnected || isRunningTests}
              className="flex items-center gap-2 px-4 py-2 bg-yellow-600 hover:bg-yellow-700 disabled:bg-gray-600 text-black rounded-lg transition-colors"
            >
              <Send className="w-4 h-4" />
              Send Boost
            </button>
          </div>
        </div>

        {/* Test Results */}
        <div className="space-y-3">
          <h3 className="text-white font-semibold">Test Results</h3>
          {testResults.length === 0 ? (
            <div className="text-gray-400 text-center py-8">
              No tests run yet. Click &quot;Run All Tests&quot; to start.
            </div>
          ) : (
            testResults.map((result, index) => (
              <div key={index} className="p-4 bg-gray-800 rounded-lg">
                <div className="flex items-center gap-3 mb-2">
                  {getStatusIcon(result.status)}
                  <span className="font-medium text-white">{result.test}</span>
                  <span className={`px-2 py-1 rounded text-xs ${
                    result.status === 'success' 
                      ? 'bg-green-500/20 text-green-400'
                      : result.status === 'error'
                      ? 'bg-red-500/20 text-red-400'
                      : 'bg-yellow-500/20 text-yellow-400'
                  }`}>
                    {result.status}
                  </span>
                </div>
                <p className="text-gray-300 text-sm mb-2">{result.message}</p>
                {result.details && (
                  <details className="text-xs text-gray-400">
                    <summary className="cursor-pointer hover:text-gray-300">Details</summary>
                    <pre className="mt-2 p-2 bg-gray-900 rounded overflow-x-auto">
                      {JSON.stringify(result.details, null, 2)}
                    </pre>
                  </details>
                )}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
