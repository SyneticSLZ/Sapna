// Email Campaign Manager - Main Application JavaScript
// ========================================================

// Configuration
const CONFIG = {
    API_BASE_URL: 'http://localhost:3000/api', // Change to your API base URL
    TOKEN_KEY: 'email_campaign_token',
    USER_KEY: 'email_campaign_user',
    DEFAULT_PAGINATION_LIMIT: 10,
    EMAIL_PLACEHOLDER_REGEX: /\{([a-z_]+)\}/g,
    DEBOUNCE_DELAY: 300, // ms
    TOAST_DURATION: 3000, // ms
};

// State Management - Central application state
const APP_STATE = {
    currentUser: null,
    currentPage: 'auth-page',
    currentTab: 'dashboard-tab',
    isAuthenticated: false,
    campaigns: [],
    campaignsPagination: {
        page: 1,
        limit: CONFIG.DEFAULT_PAGINATION_LIMIT,
        total: 0
    },
    leads: [],
    leadsPagination: {
        page: 1,
        limit: CONFIG.DEFAULT_PAGINATION_LIMIT,
        total: 0
    },
    gmailAccounts: [],
    selectedCampaign: null,
    selectedLead: null,
    filters: {
        campaigns: {},
        leads: {}
    },
    quillEditor: null,
    signatureEditor: null,
    charts: {
        activityChart: null,
        timeChart: null,
        campaignComparisonChart: null
    },
    campaignForm: {
        step: 1,
        leadFile: null,
        leadData: [],
        uploadedLeads: [],
        emailBody: '',
        followUps: [],
    },
    importLeadsData: {
        file: null,
        headers: [],
        mappings: {},
        data: [],
        skipFirstRow: true
    }
};

// API Service - Handle all API calls
const ApiService = {
    // Set auth token for API calls
    setAuthToken: (token) => {
        if (token) {
            localStorage.setItem(CONFIG.TOKEN_KEY, token);
        } else {
            localStorage.removeItem(CONFIG.TOKEN_KEY);
        }
    },

    // Get auth token
    getAuthToken: () => {
        return localStorage.getItem(CONFIG.TOKEN_KEY);
    },

    // Make API call with proper headers and error handling
    async call(endpoint, method = 'GET', data = null) {
        const url = `${CONFIG.API_BASE_URL}${endpoint}`;
        
        const headers = {
            'Content-Type': 'application/json'
        };
        
        // Add auth token if available
        const token = this.getAuthToken();
        if (token) {
            headers['Authorization'] = `Bearer ${token}`;
        }
        
        const config = {
            method,
            headers,
            credentials: 'include'
        };
        
        if (data && method !== 'GET') {
            config.body = JSON.stringify(data);
        }
        
        try {
            const response = await fetch(url, config);
            
            // Handle unauthorized responses
            if (response.status === 401) {
                UIService.showToast('Your session has expired. Please log in again.', 'error');
                AuthService.logout();
                return null;
            }
            
            const result = await response.json();
            
            if (!response.ok) {
                throw new Error(result.error || 'An unexpected error occurred');
            }
            
            return result;
        } catch (error) {
            console.error('API Error:', error);
            UIService.showToast(error.message, 'error');
            throw error;
        }
    },
    
    // Upload file to API
    async uploadFile(endpoint, file, additionalData = {}) {
        const url = `${CONFIG.API_BASE_URL}${endpoint}`;
        
        const formData = new FormData();
        formData.append('file', file);
        
        // Add any additional data
        for (const key in additionalData) {
            formData.append(key, additionalData[key]);
        }
        
        const headers = {};
        const token = this.getAuthToken();
        if (token) {
            headers['Authorization'] = `Bearer ${token}`;
        }
        
        try {
            const response = await fetch(url, {
                method: 'POST',
                headers,
                body: formData,
                credentials: 'include'
            });
            
            if (response.status === 401) {
                UIService.showToast('Your session has expired. Please log in again.', 'error');
                AuthService.logout();
                return null;
            }
            
            const result = await response.json();
            
            if (!response.ok) {
                throw new Error(result.error || 'An unexpected error occurred');
            }
            
            return result;
        } catch (error) {
            console.error('API Error:', error);
            UIService.showToast(error.message, 'error');
            throw error;
        }
    }
};

// Auth Service - Handle user authentication
const AuthService = {
    // Check if user is logged in
    isAuthenticated: () => {
        return !!ApiService.getAuthToken();
    },
    
    // Store user data
    setCurrentUser: (userData) => {
        localStorage.setItem(CONFIG.USER_KEY, JSON.stringify(userData));
        APP_STATE.currentUser = userData;
        APP_STATE.isAuthenticated = true;
    },
    
    // Get current user data
    getCurrentUser: () => {
        if (APP_STATE.currentUser) return APP_STATE.currentUser;
        
        const userData = localStorage.getItem(CONFIG.USER_KEY);
        if (userData) {
            APP_STATE.currentUser = JSON.parse(userData);
            return APP_STATE.currentUser;
        }
        return null;
    },
    
    // Login user
    async login(email, password) {
        try {
            UIService.showLoader('Logging in...');
            
            const response = await ApiService.call('/auth/login', 'POST', {
                email,
                password
            });
            
            if (response && response.token) {
                ApiService.setAuthToken(response.token);
                this.setCurrentUser(response.user);
                
                UIService.hideLoader();
                UIService.showToast('Login successful!', 'success');
                UIService.navigateTo('app-page');
                
                // Initialize app data
                await Promise.all([
                    CampaignService.loadCampaigns(),
                    GmailService.loadGmailAccounts(),
                    DashboardService.loadDashboardData()
                ]);
                
                return true;
            }
        } catch (error) {
            UIService.hideLoader();
            return false;
        }
    },
    
    // Register user
    async register(firstName, lastName, email, password) {
        try {
            UIService.showLoader('Creating account...');
            
            const response = await ApiService.call('/auth/register', 'POST', {
                firstName,
                lastName,
                email,
                password
            });
            
            UIService.hideLoader();
            
            if (response && response.userId) {
                UIService.showToast('Account created successfully! Please check your email to verify your account.', 'success');
                
                // Switch back to login
                document.getElementById('login-tab').click();
                return true;
            }
        } catch (error) {
            UIService.hideLoader();
            return false;
        }
    },
    
    // Forgot password
    async forgotPassword(email) {
        try {
            UIService.showLoader('Sending password reset link...');
            
            const response = await ApiService.call('/auth/forgot-password', 'POST', {
                email
            });
            
            UIService.hideLoader();
            
            if (response && response.message) {
                UIService.showToast('Password reset link sent to your email.', 'success');
                
                // Switch back to login
                document.getElementById('login-tab').click();
                return true;
            }
        } catch (error) {
            UIService.hideLoader();
            return false;
        }
    },
    
    // Logout user
    logout() {
        ApiService.setAuthToken(null);
        localStorage.removeItem(CONFIG.USER_KEY);
        
        APP_STATE.currentUser = null;
        APP_STATE.isAuthenticated = false;
        
        UIService.navigateTo('auth-page');
        UIService.showToast('You have been logged out.', 'info');
    },
    
    // Update user profile
    async updateProfile(userData) {
        try {
            UIService.showLoader('Updating profile...');
            
            const response = await ApiService.call('/auth/profile', 'PUT', userData);
            
            UIService.hideLoader();
            
            if (response && response.user) {
                this.setCurrentUser(response.user);
                UIService.showToast('Profile updated successfully!', 'success');
                UIService.updateUserInfo();
                return true;
            }
        } catch (error) {
            UIService.hideLoader();
            return false;
        }
    },
    
    // Change password
    async changePassword(currentPassword, newPassword) {
        try {
            UIService.showLoader('Updating password...');
            
            const response = await ApiService.call('/auth/change-password', 'PUT', {
                currentPassword,
                newPassword
            });
            
            UIService.hideLoader();
            
            if (response && response.message) {
                UIService.showToast('Password changed successfully!', 'success');
                return true;
            }
        } catch (error) {
            UIService.hideLoader();
            return false;
        }
    }
};

// Campaign Service - Handle campaign operations
const CampaignService = {
    async verifyEmails(emails) {
        const results = [];
        for (const email of emails) {
            try {
                const response = await ApiService.call('/verify-email-hunter', 'POST', { email });
                results.push({
                    email,
                    status: response.data.result, // 'deliverable', 'undeliverable', etc.
                    score: response.data.score,
                    error: response.data.result === 'undeliverable' ? 'Invalid email' : null
                });
            } catch (error) {
                results.push({
                    email,
                    status: 'error',
                    score: 0,
                    error: error.message || 'Verification failed'
                });
            }
        }
        return results;
    },
    // Load campaigns list
    async loadCampaigns(page = 1, filters = {}) {
        try {
            const queryParams = new URLSearchParams();
            queryParams.append('page', page);
            queryParams.append('limit', CONFIG.DEFAULT_PAGINATION_LIMIT);
            
            // Add filters
            for (const key in filters) {
                if (filters[key] && filters[key] !== 'all') {
                    queryParams.append(key, filters[key]);
                }
            }
            
            const endpoint = `/campaigns?${queryParams.toString()}`;
            const response = await ApiService.call(endpoint);
            
            if (response && response.campaigns) {
                APP_STATE.campaigns = response.campaigns;
                APP_STATE.campaignsPagination = {
                    page,
                    limit: CONFIG.DEFAULT_PAGINATION_LIMIT,
                    total: response.total || response.campaigns.length
                };
                
                // Update UI
                UIService.renderCampaignsTable();
                return response.campaigns;
            }
            return [];
        } catch (error) {
            console.error('Error loading campaigns:', error);
            return [];
        }
    },
    
    // Get campaign details
    async getCampaignDetails(campaignId) {
        try {
            const response = await ApiService.call(`/campaigns/${campaignId}`);
            
            if (response && response.campaign) {
                APP_STATE.selectedCampaign = response.campaign;
                
                // Update UI
                UIService.renderCampaignDetails();
                return response.campaign;
            }
            return null;
        } catch (error) {
            console.error('Error loading campaign details:', error);
            return null;
        }
    },
    
    // Create new campaign
    async createCampaign(campaignData) {
        try {
          UIService.showLoader('Creating campaign...');

        //   const userSettings = await SettingsService.loadSettings(); // Assuming this returns settings including emailSignature
            // let signature = userSettings.emailSignature || ''; // Fallback to empty string if no signature

            // If no signature in settings, try fetching from Gmail
            // if (!signature && APP_STATE.gmailAccounts.length > 0) {
                const defaultGmail = APP_STATE.gmailAccounts[0]; // Use the first connected account
                const gmailResponse = await ApiService.call(`/gmail/accounts/${encodeURIComponent(defaultGmail.email)}/signature`);
                signature = gmailResponse.signature || '';
            // }

            // Append signature to email body if it exists and isn't already included
            let emailBody = APP_STATE.quillEditor.root.innerHTML;
            if (signature && !emailBody.toLowerCase().includes(signature.toLowerCase())) {
                emailBody += `<br><br>${signature}`;
            }

      
          const response = await ApiService.call('/campaigns', 'POST', {
            campaignName: document.getElementById('campaign-name').value,
            sendingAccount: document.getElementById('campaign-sending-account').value,
            startDate: document.getElementById('campaign-start-date').value,
            sendSpeed: document.getElementById('campaign-send-speed').value,
            trackOpens: document.getElementById('campaign-track-opens').checked,
            trackClicks: document.getElementById('campaign-track-clicks').checked,
            emailSubject: document.getElementById('email-subject').value,
            emailBody: APP_STATE.quillEditor.root.innerHTML,
            followUpEmails: APP_STATE.campaignForm.followUps
          });
      
          UIService.hideLoader();
      
          if (response && response.campaignId) {
            UIService.showToast('Campaign created successfully!', 'success');
      
            // Reload campaigns
            await this.loadCampaigns();
      
            return response.campaignId;
          }
          return null;
        } catch (error) {
          UIService.hideLoader();
          return null;
        }
      },
    
    // Upload leads for campaign
    // async uploadCampaignLeads(campaignId, file, options = {}) {
    //     try {
    //         UIService.showLoader('Uploading leads...');

    //         // Step 1: Parse the file into leads
    //         const { headers, data: parsedLeads } = await this.parseLeadFile(file);

    //         // Step 2: Validate that we have leads to upload
    //         if (!parsedLeads || parsedLeads.length === 0) {
    //             UIService.hideLoader();
    //             UIService.showToast('No valid leads found in the file.', 'error');
    //             return false;
    //         }

    //         // Log the parsed leads for debugging
    //         console.log('Parsed leads to upload:', parsedLeads);

    //         // Step 3: Prepare the payload with parsed leads and options
    //         const payload = {
    //             leads: parsedLeads,
    //             // skipFirstRow: options.skipFirstRow || true, // This might not be needed anymore
    //             // verifyEmails: options.verifyEmails || false,
    //             // columnMapping: options.columnMapping || {}
    //         };

    //         // Step 4: Send the parsed leads to the backend as JSON
    //         const response = await ApiService.call(
    //             `/campaigns/${campaignId}/leads`,
    //             'POST',
    //             payload
    //         );

    //         UIService.hideLoader();

    //         // Step 5: Check the response
    //         if (response && response.leadCount) {
    //             UIService.showToast(`${response.leadCount} leads added to campaign!`, 'success');
    //             return true;
    //         } else {
    //             UIService.showToast('Failed to upload leads.', 'error');
    //             return false;
    //         }
    //     } catch (error) {
    //         console.error('Error uploading leads:', error);
    //         UIService.hideLoader();
    //         UIService.showToast('Error uploading leads: ' + error.message, 'error');
    //         return false;
    //     }
    // },
    async uploadCampaignLeads(campaignId, file, options = {}) {
        try {
            UIService.showLoader('Uploading and verifying leads...');

            // Parse the file
            const { headers, data: parsedLeads } = await this.parseLeadFile(file);
            if (!parsedLeads || parsedLeads.length === 0) {
                UIService.hideLoader();
                UIService.showToast('No valid leads found in the file.', 'error');
                return false;
            }

            // Extract emails
            const emails = parsedLeads.map(lead => lead.email).filter(email => email && Utils.validateEmail(email));
            if (emails.length === 0) {
                UIService.hideLoader();
                UIService.showToast('No valid email addresses found in the file.', 'error');
                return false;
            }

            // Verify emails
            const verificationResults = await this.verifyEmails(emails);
            UIService.renderEmailVerificationResults(verificationResults);

            // Filter out undeliverable emails
            const validLeads = parsedLeads.filter(lead => {
                const result = verificationResults.find(r => r.email === lead.email);
                return result && result.status === 'deliverable';
            });

            if (validLeads.length === 0) {
                UIService.hideLoader();
                UIService.showToast('No deliverable emails found after verification.', 'error');
                return false;
            }

            // Update APP_STATE with verified leads
            APP_STATE.campaignForm.leadData = validLeads;

            // Upload verified leads to the backend
            const payload = {
                leads: validLeads
            };
            const response = await ApiService.call(`/campaigns/${campaignId}/leads`, 'POST', payload);

            UIService.hideLoader();

            if (response && response.leadCount) {
                UIService.showToast(`${response.leadCount} verified leads added to campaign!`, 'success');
                return true;
            } else {
                UIService.showToast('Failed to upload verified leads.', 'error');
                return false;
            }
        } catch (error) {
            console.error('Error uploading and verifying leads:', error);
            UIService.hideLoader();
            UIService.showToast('Error: ' + error.message, 'error');
            return false;
        }
    },
    // Start campaign
    async startCampaign(campaignId) {
        try {
            UIService.showLoader('Starting campaign...');
            
            const response = await ApiService.call(`/campaigns/${campaignId}/start`, 'POST');
            
            UIService.hideLoader();
            
            if (response && response.success) {
                UIService.showToast('Campaign started successfully!', 'success');
                
                // Reload campaign details
                await this.getCampaignDetails(campaignId);
                
                // Reload campaigns list
                await this.loadCampaigns();
                
                return true;
            }
            return false;
        } catch (error) {
            UIService.hideLoader();
            return false;
        }
    },
    
    // Pause campaign
    async pauseCampaign(campaignId) {
        try {
            UIService.showLoader('Pausing campaign...');
            
            const response = await ApiService.call(`/campaigns/${campaignId}/pause`, 'POST');
            
            UIService.hideLoader();
            
            if (response && response.success) {
                UIService.showToast('Campaign paused successfully!', 'success');
                
                // Reload campaign details
                await this.getCampaignDetails(campaignId);
                
                // Reload campaigns list
                await this.loadCampaigns();
                
                return true;
            }
            return false;
        } catch (error) {
            UIService.hideLoader();
            return false;
        }
    },
    
    // Resume campaign
    async resumeCampaign(campaignId) {
        try {
            UIService.showLoader('Resuming campaign...');
            
            const response = await ApiService.call(`/campaigns/${campaignId}/resume`, 'POST');
            
            UIService.hideLoader();
            
            if (response && response.success) {
                UIService.showToast('Campaign resumed successfully!', 'success');
                
                // Reload campaign details
                await this.getCampaignDetails(campaignId);
                
                // Reload campaigns list
                await this.loadCampaigns();
                
                return true;
            }
            return false;
        } catch (error) {
            UIService.hideLoader();
            return false;
        }
    },
    
    // Delete campaign
    async deleteCampaign(campaignId) {
        try {
            UIService.showLoader('Deleting campaign...');
            
            const response = await ApiService.call(`/campaigns/${campaignId}`, 'DELETE');
            
            UIService.hideLoader();
            
            if (response && response.success) {
                UIService.showToast('Campaign deleted successfully!', 'success');
                
                // Reload campaigns list
                await this.loadCampaigns();
                
                return true;
            }
            return false;
        } catch (error) {
            UIService.hideLoader();
            return false;
        }
    },
    
    // Parse CSV/Excel file for leads
    // async parseLeadFile(file) {
    //     return new Promise((resolve, reject) => {
    //         const fileReader = new FileReader();
            
    //         fileReader.onload = (event) => {
    //             try {
    //                 const data = event.target.result;
    //                 let parsedData = [];
    //                 let headers = [];
                    
    //                 if (file.name.endsWith('.csv')) {
    //                     // Parse CSV
    //                     Papa.parse(data, {
    //                         header: true,
    //                         skipEmptyLines: true,
    //                         complete: (results) => {
    //                             parsedData = results.data;
    //                             headers = results.meta.fields;
    //                             resolve({ headers, data: parsedData });
    //                         },
    //                         error: (error) => {
    //                             reject(error);
    //                         }
    //                     });
    //                 } else {
    //                     // Parse Excel
    //                     const workbook = XLSX.read(data, { type: 'binary' });
    //                     const sheetName = workbook.SheetNames[0];
    //                     const worksheet = workbook.Sheets[sheetName];
                        
    //                     // Convert to JSON
    //                     parsedData = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
                        
    //                     // Extract headers and remove them from data
    //                     if (parsedData.length > 0) {
    //                         headers = parsedData[0];
    //                         parsedData = parsedData.slice(1).map(row => {
    //                             const rowData = {};
    //                             headers.forEach((header, index) => {
    //                                 rowData[header] = row[index] || '';
    //                             });
    //                             return rowData;
    //                         });
    //                     }
                        
    //                     resolve({ headers, data: parsedData });
    //                 }
    //             } catch (error) {
    //                 reject(error);
    //             }
    //         };
            
    //         fileReader.onerror = () => {
    //             reject(new Error('Error reading file'));
    //         };
            
    //         if (file.name.endsWith('.csv')) {
    //             fileReader.readAsText(file);
    //         } else {
    //             fileReader.readAsBinaryString(file);
    //         }
    //     });
    // }
    formatRevenue(value) {
        try {
            const num = parseFloat(value.toString().replace(/[^0-9.]/g, ''));
            if (isNaN(num)) return value;
            return new Intl.NumberFormat('en-US', {
                style: 'currency',
                currency: 'USD',
                minimumFractionDigits: 0,
                maximumFractionDigits: 0
            }).format(num);
        } catch (error) {
            console.error('Error formatting revenue:', error);
            return value;
        }
    },

    async parseLeadFile(file) {
        return new Promise(async (resolve, reject) => {
            try {
                console.log('Starting file processing:', file.name);

                // Read file as array buffer
                const arrayBuffer = await file.arrayBuffer();
                const workbook = XLSX.read(new Uint8Array(arrayBuffer), {
                    type: 'array',
                    cellDates: true,
                    cellNF: false,
                    cellText: false,
                    raw: true
                });

                const worksheetName = workbook.SheetNames[0];
                const worksheet = workbook.Sheets[worksheetName];

                // Convert to JSON with row array format
                const jsonData = XLSX.utils.sheet_to_json(worksheet, {
                    header: 1,
                    defval: '',
                    blankrows: false
                });

                // Extract headers from first row
                const headers = jsonData[0] || [];
                const processedData = [];

                // Process each row (skip header row)
                for (let i = 1; i < jsonData.length; i++) {
                    const row = jsonData[i];

                    // Skip empty rows
                    if (!row || !row.some(cell => cell && cell.toString().trim() !== '')) {
                        continue;
                    }

                    // Map row data to object with specific fields
                    const rowData = {
                        company: row[0] || '',
                        firstName: row[1] || '',  // Adjusted to match APP_STATE field names
                        lastName: row[2] || '',
                        title: row[3] || '',
                        email: row[4] || '',      // Using 'email' instead of 'email_1'
                        email_2: row[5] || '',    // Keeping secondary email if needed
                        revenue: row[6] ? this.formatRevenue(row[6]) : '',
                        website: row[7] || '',
                        linkedin: row[8] || '',
                        industry: row[10] || '',
                        employees: row[11] || '',
                        city: row[12] || '',
                        state: row[13] || ''
                    };

                    // Validate the row has at least some required fields
                    if (rowData.company || rowData.firstName || rowData.email) {
                        processedData.push(rowData);
                    }
                }

                // Resolve with headers and processed data
                resolve({ headers, data: processedData });
            } catch (error) {
                console.error('Error parsing file:', error);
                reject(new Error('Error processing file: ' + error.message));
            }
        });
    }
};

// Leads Service - Handle leads operations
const LeadService = {
    // Load leads list
    async loadLeads(page = 1, filters = {}) {
        try {
            const queryParams = new URLSearchParams();
            queryParams.append('page', page);
            queryParams.append('limit', CONFIG.DEFAULT_PAGINATION_LIMIT);
            
            // Add filters
            for (const key in filters) {
                if (filters[key] && filters[key] !== 'all') {
                    queryParams.append(key, filters[key]);
                }
            }
            
            const endpoint = `/leads?${queryParams.toString()}`;
            const response = await ApiService.call(endpoint);
            
            if (response && response.leads) {
                APP_STATE.leads = response.leads;
                APP_STATE.leadsPagination = {
                    page,
                    limit: CONFIG.DEFAULT_PAGINATION_LIMIT,
                    total: response.total || response.leads.length
                };
                
                // Update UI
                UIService.renderLeadsTable();
                return response.leads;
            }
            return [];
        } catch (error) {
            console.error('Error loading leads:', error);
            return [];
        }
    },
    
    // Get lead details
    async getLeadDetails(leadId) {
        try {
            const response = await ApiService.call(`/leads/${leadId}`);
            
            if (response && response.lead) {
                APP_STATE.selectedLead = response.lead;
                
                // Update UI
                UIService.renderLeadDetails();
                return response.lead;
            }
            return null;
        } catch (error) {
            console.error('Error loading lead details:', error);
            return null;
        }
    },
    
    // Create new lead
    async createLead(leadData) {
        try {
            UIService.showLoader('Creating lead...');
            
            const response = await ApiService.call('/leads', 'POST', leadData);
            
            UIService.hideLoader();
            
            if (response && response.leadId) {
                UIService.showToast('Lead created successfully!', 'success');
                
                // Reload leads
                await this.loadLeads();
                
                return response.leadId;
            }
            return null;
        } catch (error) {
            UIService.hideLoader();
            return null;
        }
    },
    
    // Update lead
    async updateLead(leadId, leadData) {
        try {
            UIService.showLoader('Updating lead...');
            
            const response = await ApiService.call(`/leads/${leadId}`, 'PUT', leadData);
            
            UIService.hideLoader();
            
            if (response && response.success) {
                UIService.showToast('Lead updated successfully!', 'success');
                
                // Reload leads
                await this.loadLeads();
                
                return true;
            }
            return false;
        } catch (error) {
            UIService.hideLoader();
            return false;
        }
    },
    
    // Delete lead
    async deleteLead(leadId) {
        try {
            UIService.showLoader('Deleting lead...');
            
            const response = await ApiService.call(`/leads/${leadId}`, 'DELETE');
            
            UIService.hideLoader();
            
            if (response && response.success) {
                UIService.showToast('Lead deleted successfully!', 'success');
                
                // Reload leads
                await this.loadLeads();
                
                return true;
            }
            return false;
        } catch (error) {
            UIService.hideLoader();
            return false;
        }
    },
    
    // Import leads
    async importLeads(file, options = {}) {
        try {
            UIService.showLoader('Importing leads...');
            
            const additionalData = {
                skipFirstRow: options.skipFirstRow || true,
                verifyEmails: options.verifyEmails || false,
                columnMapping: JSON.stringify(options.columnMapping || {})
            };
            
            const response = await ApiService.uploadFile('/leads/import', file, additionalData);
            
            UIService.hideLoader();
            
            if (response && response.importedCount) {
                UIService.showToast(`${response.importedCount} leads imported successfully!`, 'success');
                
                // Reload leads
                await this.loadLeads();
                
                return true;
            }
            return false;
        } catch (error) {
            UIService.hideLoader();
            return false;
        }
    },
    
    // Verify email address
    async verifyEmail(email) {
        try {
            const response = await ApiService.call('/verify-email', 'POST', { email });
            
            if (response && response.result) {
                return response.result;
            }
            return null;
        } catch (error) {
            console.error('Error verifying email:', error);
            return null;
        }
    }
};

// Gmail Service - Handle Gmail integration
const GmailService = {
    // Load Gmail accounts
    async loadGmailAccounts() {
        try {
            const response = await ApiService.call('/gmail/accounts');
            
            if (response && response.accounts) {
                APP_STATE.gmailAccounts = response.accounts;
                
                // Update UI
                UIService.renderGmailAccounts();
                return response.accounts;
            }
            return [];
        } catch (error) {
            console.error('Error loading Gmail accounts:', error);
            return [];
        }
    },
    
    // Connect Gmail account
    async connectGmail() {
        try {
            UIService.showLoader('Connecting to Gmail...');
            
            const response = await ApiService.call('/gmail/auth');
            
            UIService.hideLoader();
            
            if (response && response.url) {
                // Open Gmail authorization in a popup
                const authWindow = window.open(response.url, 'GmailAuth', 'width=600,height=600');
                
                // Poll for window to close
                const pollInterval = setInterval(() => {
                    if (authWindow.closed) {
                        clearInterval(pollInterval);
                        
                        // Reload Gmail accounts
                        this.loadGmailAccounts();
                    }
                }, 1000);
                
                return true;
            }
            return false;
        } catch (error) {
            UIService.hideLoader();
            return false;
        }
    },
    
    // Test Gmail connection
    async testGmailConnection(email) {
        try {
            UIService.showLoader('Testing connection...');
            
            const response = await ApiService.call('/gmail/test', 'POST', { email });
            
            UIService.hideLoader();
            
            if (response && response.success) {
                UIService.showToast('Gmail connection successful!', 'success');
                
                const testResult = document.getElementById('test-result');
                testResult.classList.remove('hidden');
                testResult.classList.add('bg-green-50', 'text-green-800');
                testResult.innerHTML = `
                    <p class="font-medium">Connection successful!</p>
                    <p>Email: ${response.email}</p>
                    <p>Messages in inbox: ${response.messagesTotal}</p>
                `;
                
                return true;
            }
            return false;
        } catch (error) {
            UIService.hideLoader();
            
            const testResult = document.getElementById('test-result');
            testResult.classList.remove('hidden');
            testResult.classList.add('bg-red-50', 'text-red-800');
            testResult.innerHTML = `
                <p class="font-medium">Connection failed</p>
                <p>${error.message}</p>
            `;
            
            return false;
        }
    },
    
    // Remove Gmail account
    async removeGmailAccount(email) {
        try {
            UIService.showLoader('Removing account...');
            
            const response = await ApiService.call(`/gmail/accounts/${encodeURIComponent(email)}`, 'DELETE');
            
            UIService.hideLoader();
            
            if (response && response.success) {
                UIService.showToast('Gmail account removed successfully!', 'success');
                
                // Reload Gmail accounts
                await this.loadGmailAccounts();
                
                return true;
            }
            return false;
        } catch (error) {
            UIService.hideLoader();
            return false;
        }
    }
};

// Dashboard Service - Handle dashboard data
const DashboardService = {
    // Load dashboard data
    async loadDashboardData() {
        try {
            // Get the stored user data
            const userData = localStorage.getItem('email_campaign_user');
            if (!userData) {
                console.error("No user data found in local storage");
                return false;
            }
    
            // Parse stored user data
            const user = JSON.parse(userData);
            const userEmail = user.email; // Extract email
    
            // Send email as a query param or in the body
            const response = await ApiService.call(`/dashboard?email=${encodeURIComponent(userEmail)}`);
            console.log(response)
            if (response && response.stats) {
                const { stats, campaigns, leadsWithReplies } = response;
    
                document.getElementById('active-campaigns-count').textContent = stats.totalCampaigns || 0;
                document.getElementById('emails-sent-count').textContent = stats.totalEmailsSent || 0;
                document.getElementById('open-rate').textContent = `${stats.openRate || 0}%`;
                document.getElementById('response-rate').textContent = `${stats.totalReplies || 0}%`;
    
                this.renderRecentCampaigns(campaigns || []);
                this.renderRecentActivity(leadsWithReplies || []);
    
                return true;
            }
            
            return false;
        } catch (error) {
            console.error('Error loading dashboard data:', error);
            return false;
        }
    },
    
    
    // Render recent campaigns
    renderRecentCampaigns(campaigns) {
        const container = document.getElementById('recent-campaigns-list');
        
        if (!container) return;
        
        if (campaigns.length === 0) {
            container.innerHTML = '<p class="text-gray-500 text-sm py-2">No recent campaigns</p>';
            return;
        }
        
        container.innerHTML = campaigns.map(campaign => `
            <div class="border-b border-gray-200 pb-2 last:border-b-0 last:pb-0">
                <div class="flex justify-between items-center">
                    <div>
                        <p class="text-sm font-medium text-gray-900">${campaign.name}</p>
                        <p class="text-xs text-gray-500">
                            ${this.getStatusBadge(campaign.status)}
                            <span class="ml-2">${campaign.sentCount}/${campaign.leadCount} sent</span>
                        </p>
                    </div>
                    <button class="text-xs text-indigo-600 hover:text-indigo-800" 
                            onclick="CampaignService.getCampaignDetails('${campaign._id}'); UIService.switchTab('campaigns-tab');">
                        View
                    </button>
                </div>
            </div>
        `).join('');
    },
    
    // Render recent activity
    renderRecentActivity(leadsWithReplies) {
        const container = document.getElementById('recent-activity-list');
        
        if (!container) return;
        
        if (!leadsWithReplies || !Array.isArray(leadsWithReplies)) {
            container.innerHTML = '<p class="text-gray-500 text-sm py-2">No recent replies</p>';
            return;
        }
    
        const allReplies = leadsWithReplies
            .flatMap(lead => lead.replies.map(reply => ({
                email: lead.email,
                content: reply.content,
                timestamp: reply.date
            })))
            .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
        
        if (allReplies.length === 0) {
            container.innerHTML = '<p class="text-gray-500 text-sm py-2">No recent replies</p>';
            return;
        }
        
        console.log("All replies:", allReplies); // Debug: Check the full array
        
        container.innerHTML = allReplies.map(reply => {
            // Ensure content is a string, default to "No content" if missing
            const content = typeof reply.content === 'string' ? reply.content : 'No content';
            const displayContent = content.length > 50 ? content.substring(0, 50) + '...' : content;
            
            return `
                <div class="border-b border-gray-200 pb-2 last:border-b-0 last:pb-0">
                    <div class="flex items-start">
                        <div class="flex-shrink-0">
                            ${this.getActivityIcon('Reply')}
                        </div>
                        <div class="ml-3">
                            <p class="text-sm text-gray-900">
                                Reply from <span class="font-medium">${reply.email}</span>: 
                                "${displayContent}"
                            </p>
                            <p class="text-xs text-gray-500">${this.formatDateTime(reply.timestamp)}</p>
                        </div>
                    </div>
                </div>
            `;
        }).join('');
    },
    
    // Helper method for status badge
    getStatusBadge(status) {
        let color = 'gray';
        
        switch (status.toLowerCase()) {
            case 'active':
                color = 'green';
                break;
            case 'paused':
                color = 'yellow';
                break;
            case 'completed':
                color = 'blue';
                break;
            case 'draft':
                color = 'gray';
                break;
            case 'failed':
                color = 'red';
                break;
        }
        
        return `<span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-${color}-100 text-${color}-800">
            ${status}
        </span>`;
    },
    
    // Helper method for activity icon
    getActivityIcon(type) {
        switch (type) {
            case 'email_sent':
                return '<div class="h-8 w-8 rounded-full bg-blue-100 flex items-center justify-center"><i class="fas fa-paper-plane text-blue-600"></i></div>';
            case 'email_opened':return '<div class="h-8 w-8 rounded-full bg-green-100 flex items-center justify-center"><i class="fas fa-envelope-open text-green-600"></i></div>';
            case 'email_clicked':
                return '<div class="h-8 w-8 rounded-full bg-purple-100 flex items-center justify-center"><i class="fas fa-mouse-pointer text-purple-600"></i></div>';
            case 'email_replied':
                return '<div class="h-8 w-8 rounded-full bg-indigo-100 flex items-center justify-center"><i class="fas fa-reply text-indigo-600"></i></div>';
            case 'campaign_started':
                return '<div class="h-8 w-8 rounded-full bg-yellow-100 flex items-center justify-center"><i class="fas fa-play text-yellow-600"></i></div>';
            case 'campaign_completed':
                return '<div class="h-8 w-8 rounded-full bg-green-100 flex items-center justify-center"><i class="fas fa-check text-green-600"></i></div>';
            default:
                return '<div class="h-8 w-8 rounded-full bg-gray-100 flex items-center justify-center"><i class="fas fa-bell text-gray-600"></i></div>';
        }
    },
    
    // Format date time for display
    formatDateTime(dateString) {
        const date = new Date(dateString);
        const now = new Date();
        const diffMs = now - date;
        const diffSec = Math.floor(diffMs / 1000);
        const diffMin = Math.floor(diffSec / 60);
        const diffHour = Math.floor(diffMin / 60);
        const diffDay = Math.floor(diffHour / 24);
        
        if (diffSec < 60) {
            return 'just now';
        } else if (diffMin < 60) {
            return `${diffMin} minute${diffMin === 1 ? '' : 's'} ago`;
        } else if (diffHour < 24) {
            return `${diffHour} hour${diffHour === 1 ? '' : 's'} ago`;
        } else if (diffDay < 7) {
            return `${diffDay} day${diffDay === 1 ? '' : 's'} ago`;
        } else {
            return date.toLocaleDateString();
        }
    }
};

// Analytics Service - Handle analytics data
const AnalyticsService = {
    // Load analytics data
    async loadAnalyticsData(filters = {}) {
        try {
            const queryParams = new URLSearchParams();
            
            // Add filters
            for (const key in filters) {
                if (filters[key] && filters[key] !== 'all') {
                    queryParams.append(key, filters[key]);
                }
            }
            const userData = localStorage.getItem('email_campaign_user');
            if (!userData) {
                console.error("No user data found in local storage");
                return false;
            }
    
            // Parse stored user data
            const user = JSON.parse(userData);
            const userEmail = user.email; // Extract email
    
            // Send email as a query param or in the body
            // const response = await ApiService.call(`/dashboard?email=${encodeURIComponent(userEmail)}`);
    
            
            const endpoint = `/analytics?email=${encodeURIComponent(userEmail)}`;
            const response = await ApiService.call(endpoint);

            console.log(response)
            
            if (response && response.data) {
                // Update analytics UI with data
                this.updateAnalyticsStats(response.data.stats);
                this.renderAnalyticsCharts(response.data);
                this.renderTopEmails(response.data.topEmails);
                
                return true;
            }
            return false;
        } catch (error) {
            console.error('Error loading analytics data:', error);
            return false;
        }
    },
    
    // Update analytics statistics
    updateAnalyticsStats(stats) {
        document.getElementById('analytics-emails-sent').textContent = stats.emailsSent || 0;
        document.getElementById('analytics-opens').textContent = stats.opens || 0;
        document.getElementById('analytics-open-rate').textContent = `${stats.openRate || 0}%`;
        document.getElementById('analytics-clicks').textContent = stats.clicks || 0;
        document.getElementById('analytics-click-rate').textContent = `${stats.clickRate || 0}%`;
        document.getElementById('analytics-replies').textContent = stats.totalReplies || 0;
        document.getElementById('analytics-reply-rate').textContent = `${stats.totalReplies || 0}%`;
    },
    
    // Render analytics charts
    renderAnalyticsCharts(data) {
        // Activity Chart
        this.renderActivityChart(data.activityData);
        
        // Time of Day Chart
        this.renderTimeOfDayChart(data.timeData);
        
        // Campaign Comparison Chart
        this.renderCampaignComparisonChart(data.campaignData);
    },
    
    // Render activity chart
    renderActivityChart(activityData) {
        const ctx = document.getElementById('activity-chart').getContext('2d');
        
        // Destroy existing chart if exists
        if (APP_STATE.charts.activityChart) {
            APP_STATE.charts.activityChart.destroy();
        }
        
        APP_STATE.charts.activityChart = new Chart(ctx, {
            type: 'line',
            data: {
                labels: activityData.labels,
                datasets: [
                    {
                        label: 'Emails Sent',
                        data: activityData.sent,
                        borderColor: '#4F46E5',
                        backgroundColor: 'rgba(79, 70, 229, 0.1)',
                        tension: 0.3,
                        fill: true
                    },
                    {
                        label: 'Opens',
                        data: activityData.opens,
                        borderColor: '#10B981',
                        backgroundColor: 'rgba(16, 185, 129, 0.1)',
                        tension: 0.3,
                        fill: true
                    },
                    {
                        label: 'Clicks',
                        data: activityData.clicks,
                        borderColor: '#3B82F6',
                        backgroundColor: 'rgba(59, 130, 246, 0.1)',
                        tension: 0.3,
                        fill: true
                    },
                    {
                        label: 'Replies',
                        data: activityData.replies,
                        borderColor: '#8B5CF6',
                        backgroundColor: 'rgba(139, 92, 246, 0.1)',
                        tension: 0.3,
                        fill: true
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        position: 'top',
                    },
                    tooltip: {
                        mode: 'index',
                        intersect: false
                    }
                },
                scales: {
                    y: {
                        beginAtZero: true
                    }
                }
            }
        });
    },
    
    // Render time of day chart
    renderTimeOfDayChart(timeData) {
        const ctx = document.getElementById('time-chart').getContext('2d');
        
        // Destroy existing chart if exists
        if (APP_STATE.charts.timeChart) {
            APP_STATE.charts.timeChart.destroy();
        }
        
        APP_STATE.charts.timeChart = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: timeData.labels,
                datasets: [
                    {
                        label: 'Open Rate',
                        data: timeData.openRates,
                        backgroundColor: '#10B981'
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        display: false
                    },
                    tooltip: {
                        callbacks: {
                            label: function(context) {
                                return `Open Rate: ${context.raw}%`;
                            }
                        }
                    }
                },
                scales: {
                    y: {
                        beginAtZero: true,
                        max: 100,
                        ticks: {
                            callback: function(value) {
                                return value + '%';
                            }
                        }
                    }
                }
            }
        });
    },
    
    // Render campaign comparison chart
    renderCampaignComparisonChart(campaignData) {
        const ctx = document.getElementById('campaign-comparison-chart').getContext('2d');
        
        // Destroy existing chart if exists
        if (APP_STATE.charts.campaignComparisonChart) {
            APP_STATE.charts.campaignComparisonChart.destroy();
        }
        
        APP_STATE.charts.campaignComparisonChart = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: campaignData.names,
                datasets: [
                    {
                        label: 'Open Rate',
                        data: campaignData.openRates,
                        backgroundColor: '#10B981'
                    },
                    {
                        label: 'Click Rate',
                        data: campaignData.clickRates,
                        backgroundColor: '#3B82F6'
                    },
                    {
                        label: 'Reply Rate',
                        data: campaignData.replyRates,
                        backgroundColor: '#8B5CF6'
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        position: 'top',
                    },
                    tooltip: {
                        callbacks: {
                            label: function(context) {
                                return `${context.dataset.label}: ${context.raw}%`;
                            }
                        }
                    }
                },
                scales: {
                    y: {
                        beginAtZero: true,
                        max: 100,
                        ticks: {
                            callback: function(value) {
                                return value + '%';
                            }
                        }
                    }
                }
            }
        });
    },
    
    // Render top performing emails
    renderTopEmails(emails) {
        const container = document.getElementById('top-emails-table-body');
        
        if (!container) return;
        
        if (!emails || emails.length === 0) {
            container.innerHTML = '<tr><td colspan="6" class="px-6 py-4 text-center text-sm text-gray-500">No data available</td></tr>';
            return;
        }
        
        container.innerHTML = emails.map(email => `
            <tr>
                <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-900">${email.subject}</td>
                <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">${email.campaignName}</td>
                <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">${email.sentCount}</td>
                <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                    ${email.opens} <span class="text-xs text-green-600">(${email.openRate}%)</span>
                </td>
                <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                    ${email.clicks} <span class="text-xs text-blue-600">(${email.clickRate}%)</span>
                </td>
                <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                    ${email.replies} <span class="text-xs text-purple-600">(${email.replyRate}%)</span>
                </td>
            </tr>
        `).join('');
    }
};

// Settings Service - Handle user settings
const SettingsService = {
    // Load user settings
    async loadSettings() {
        try {
            const response = await ApiService.call('/settings');
            
            if (response && response.settings) {
                const { settings } = response;
                
                // Update email settings fields
                document.getElementById('default-send-speed').value = settings.defaultSendSpeed || 'medium';
                document.getElementById('track-email-opens').checked = settings.trackEmailOpens !== false;
                document.getElementById('track-link-clicks').checked = settings.trackLinkClicks !== false;
                
                // Update signature editor content
                if (APP_STATE.signatureEditor) {
                    APP_STATE.signatureEditor.root.innerHTML = settings.emailSignature || '';
                }
                
                // Update notification settings
                document.getElementById('notify-campaign-completed').checked = settings.notifyCampaignCompleted !== false;
                document.getElementById('notify-lead-replied').checked = settings.notifyLeadReplied !== false;
                document.getElementById('notify-daily-reports').checked = settings.notifyDailyReports === true;
                
                return true;
            }
            return false;
        } catch (error) {
            console.error('Error loading settings:', error);
            return false;
        }
    },
    
    // Save email settings
    async saveEmailSettings(settings) {
        try {
            UIService.showLoader('Saving settings...');
            
            const response = await ApiService.call('/settings/email', 'PUT', settings);
            
            UIService.hideLoader();
            
            if (response && response.success) {
                UIService.showToast('Email settings saved successfully!', 'success');
                return true;
            }
            return false;
        } catch (error) {
            UIService.hideLoader();
            return false;
        }
    },
    
    // Save notification settings
    async saveNotificationSettings(settings) {
        try {
            UIService.showLoader('Saving settings...');
            
            const response = await ApiService.call('/settings/notifications', 'PUT', settings);
            
            UIService.hideLoader();
            
            if (response && response.success) {
                UIService.showToast('Notification settings saved successfully!', 'success');
                return true;
            }
            return false;
        } catch (error) {
            UIService.hideLoader();
            return false;
        }
    }
};

// UI Service - Handle UI updates and interactions
const UIService = {
    // Initialize UI
    init: function() {
        this.setupEventListeners();
        this.initializeEditors();
        
        // Check if user is already logged in
        if (AuthService.isAuthenticated()) {
            this.navigateTo('app-page');
            
            // Initialize app data
            Promise.all([
                CampaignService.loadCampaigns(),
                GmailService.loadGmailAccounts(),
                DashboardService.loadDashboardData()
            ]).then(() => {
                // Update user info
                this.updateUserInfo();
            });
        }
    },
    
    // Set up event listeners
    setupEventListeners: function() {
        // Auth page event listeners
        this.setupAuthEventListeners();
        
        // Main app event listeners
        this.setupNavigationEventListeners();
        this.setupUserMenuEventListeners();
        this.setupDashboardEventListeners();
        this.setupCampaignsEventListeners();
        this.setupLeadsEventListeners();
        this.setupAnalyticsEventListeners();
        this.setupGmailEventListeners();
        this.setupSettingsEventListeners();
        
        // Modal event listeners
        this.setupModalEventListeners();
    },
    
    // Setup authentication event listeners
    setupAuthEventListeners: function() {
        // Login/Register tabs
        document.getElementById('login-tab').addEventListener('click', function() {
            document.getElementById('login-tab').classList.add('text-indigo-600', 'border-indigo-600');
            document.getElementById('login-tab').classList.remove('text-gray-500');
            
            document.getElementById('register-tab').classList.remove('text-indigo-600', 'border-indigo-600');
            document.getElementById('register-tab').classList.add('text-gray-500');
            
            document.getElementById('login-form').classList.remove('hidden');
            document.getElementById('register-form').classList.add('hidden');
            document.getElementById('forgot-password-form').classList.add('hidden');
        });
        
        document.getElementById('register-tab').addEventListener('click', function() {
            document.getElementById('register-tab').classList.add('text-indigo-600', 'border-indigo-600');
            document.getElementById('register-tab').classList.remove('text-gray-500');
            
            document.getElementById('login-tab').classList.remove('text-indigo-600', 'border-indigo-600');
            document.getElementById('login-tab').classList.add('text-gray-500');
            
            document.getElementById('register-form').classList.remove('hidden');
            document.getElementById('login-form').classList.add('hidden');
            document.getElementById('forgot-password-form').classList.add('hidden');
        });
        
        // Forgot password link
        document.getElementById('forgot-password-link').addEventListener('click', function(e) {
            e.preventDefault();
            
            document.getElementById('login-form').classList.add('hidden');
            document.getElementById('register-form').classList.add('hidden');
            document.getElementById('forgot-password-form').classList.remove('hidden');
        });
        
        // Back to login link
        document.getElementById('back-to-login').addEventListener('click', function(e) {
            e.preventDefault();
            
            document.getElementById('login-form').classList.remove('hidden');
            document.getElementById('register-form').classList.add('hidden');
            document.getElementById('forgot-password-form').classList.add('hidden');
        });
        
        // Login form submission
        document.getElementById('login-form').addEventListener('submit', async function(e) {
            e.preventDefault();
            
            const email = document.getElementById('login-email').value;
            const password = document.getElementById('login-password').value;
            
            if (!email || !password) {
                UIService.showToast('Please enter both email and password', 'error');
                return;
            }
            
            await AuthService.login(email, password);
        });
        
        // Register form submission
        document.getElementById('register-form').addEventListener('submit', async function(e) {
            e.preventDefault();
            
            const firstName = document.getElementById('register-firstname').value;
            const lastName = document.getElementById('register-lastname').value;
            const email = document.getElementById('register-email').value;
            const password = document.getElementById('register-password').value;
            
            if (!firstName || !lastName || !email || !password) {
                UIService.showToast('Please fill out all fields', 'error');
                return;
            }
            
            if (password.length < 8) {
                UIService.showToast('Password must be at least 8 characters', 'error');
                return;
            }
            
            await AuthService.register(firstName, lastName, email, password);
        });
        
        // Forgot password form submission
        document.getElementById('forgot-password-form').addEventListener('submit', async function(e) {
            e.preventDefault();
            
            const email = document.getElementById('forgot-email').value;
            
            if (!email) {
                UIService.showToast('Please enter your email', 'error');
                return;
            }
            
            await AuthService.forgotPassword(email);
        });
    },
    
    // Setup navigation event listeners
    setupNavigationEventListeners: function() {
        // Sidebar navigation links
        const navLinks = document.querySelectorAll('.nav-link');
        
        navLinks.forEach(link => {
            link.addEventListener('click', function(e) {
                e.preventDefault();
                
                // Remove active class from all links
                navLinks.forEach(l => {
                    l.classList.remove('bg-indigo-100', 'text-indigo-700');
                    l.classList.add('text-gray-600', 'hover:bg-gray-50', 'hover:text-gray-900');
                });
                
                // Add active class to clicked link
                this.classList.add('bg-indigo-100', 'text-indigo-700');
                this.classList.remove('text-gray-600', 'hover:bg-gray-50', 'hover:text-gray-900');
                
                // Switch to corresponding tab
                const tabId = this.id.replace('-link', '-tab');
                UIService.switchTab(tabId);
                
                // Load data if needed
                switch(tabId) {
                    case 'dashboard-tab':
                        DashboardService.loadDashboardData();
                        break;
                    case 'campaigns-tab':
                        CampaignService.loadCampaigns();
                        break;
                    case 'leads-tab':
                        LeadService.loadLeads();
                        break;
                    case 'analytics-tab':
                        AnalyticsService.loadAnalyticsData();
                        break;
                    case 'gmail-tab':
                        GmailService.loadGmailAccounts();
                        break;
                    case 'settings-tab':
                        SettingsService.loadSettings();
                        break;
                }
            });
        });
    },
    
    // Setup user menu event listeners
    setupUserMenuEventListeners: function() {
        // User menu toggle
        document.getElementById('user-menu-button').addEventListener('click', function() {
            document.getElementById('user-dropdown').classList.toggle('hidden');
        });
        
        // Close user menu when clicking outside
        document.addEventListener('click', function(e) {
            if (!e.target.closest('#user-menu-button') && !e.target.closest('#user-dropdown')) {
                document.getElementById('user-dropdown').classList.add('hidden');
            }
        });
        
        // Profile link
        document.getElementById('profile-link').addEventListener('click', function(e) {
            e.preventDefault();
            
            // Switch to settings tab
            document.getElementById('settings-nav-link').click();
            
            // Show profile tab in settings
            document.getElementById('profile-settings-tab').click();
        });
        
        // Settings link
        document.getElementById('settings-link').addEventListener('click', function(e) {
            e.preventDefault();
            
            // Switch to settings tab
            document.getElementById('settings-nav-link').click();
        });
        
        // Logout link
        document.getElementById('logout-link').addEventListener('click', function(e) {
            e.preventDefault();
            
            AuthService.logout();
        });
    },
    
    // Setup dashboard event listeners
    setupDashboardEventListeners: function() {
        // View all campaigns button
        document.getElementById('view-all-campaigns').addEventListener('click', function() {
            document.getElementById('campaigns-link').click();
        });
        
        // View all activity button
        document.getElementById('view-all-activity').addEventListener('click', function() {
            // For now, just refresh the dashboard data
            DashboardService.loadDashboardData();
        });
    },
    
    // Setup campaigns event listeners
    setupCampaignsEventListeners: function() {
        // Create campaign button
        document.getElementById('create-campaign-btn').addEventListener('click', function() {
            UIService.openCreateCampaignModal();
        });
        
        // Campaign filter form
        document.getElementById('apply-campaign-filters').addEventListener('click', function() {
            const status = document.getElementById('status-filter').value;
            const date = document.getElementById('date-filter').value;
            const search = document.getElementById('search-campaigns').value;
            
            const filters = {
                status,
                date,
                search
            };
            
            APP_STATE.filters.campaigns = filters;
            CampaignService.loadCampaigns(1, filters);
        });
        
        // Pagination buttons
        document.getElementById('campaigns-prev-page').addEventListener('click', function() {
            if (APP_STATE.campaignsPagination.page > 1) {
                CampaignService.loadCampaigns(
                    APP_STATE.campaignsPagination.page - 1,
                    APP_STATE.filters.campaigns
                );
            }
        });
        
        document.getElementById('campaigns-next-page').addEventListener('click', function() {
            const totalPages = Math.ceil(APP_STATE.campaignsPagination.total / APP_STATE.campaignsPagination.limit);
            
            if (APP_STATE.campaignsPagination.page < totalPages) {
                CampaignService.loadCampaigns(
                    APP_STATE.campaignsPagination.page + 1,
                    APP_STATE.filters.campaigns
                );
            }
        });
    },
    
    // Setup leads event listeners
    setupLeadsEventListeners: function() {
        // Add lead button
        document.getElementById('add-lead-btn').addEventListener('click', function() {
            UIService.openAddLeadModal();
        });
        
        // Import leads button
        document.getElementById('import-leads-btn').addEventListener('click', function() {
            UIService.openImportLeadsModal();
        });
        
        // Lead filter form
        document.getElementById('apply-lead-filters').addEventListener('click', function() {
            const status = document.getElementById('lead-status-filter').value;
            const campaign = document.getElementById('lead-campaign-filter').value;
            const search = document.getElementById('search-leads').value;
            
            const filters = {
                status,
                campaign,
                search
            };
            
            APP_STATE.filters.leads = filters;
            LeadService.loadLeads(1, filters);
        });
        
        // Pagination buttons
        document.getElementById('leads-prev-page').addEventListener('click', function() {
            if (APP_STATE.leadsPagination.page > 1) {
                LeadService.loadLeads(
                    APP_STATE.leadsPagination.page - 1,
                    APP_STATE.filters.leads
                );
            }
        });
        
        document.getElementById('leads-next-page').addEventListener('click', function() {
            const totalPages = Math.ceil(APP_STATE.leadsPagination.total / APP_STATE.leadsPagination.limit);
            
            if (APP_STATE.leadsPagination.page < totalPages) {
                LeadService.loadLeads(
                    APP_STATE.leadsPagination.page + 1,
                    APP_STATE.filters.leads
                );
            }
        });
    },
    
    // Setup analytics event listeners
    setupAnalyticsEventListeners: function() {
        // Apply filters button
        document.getElementById('apply-analytics-filters').addEventListener('click', function() {
            const campaign = document.getElementById('analytics-campaign-filter').value;
            const dateRange = document.getElementById('analytics-date-filter').value;
            const metric = document.getElementById('analytics-metric-filter').value;
            
            const filters = {
                campaign,
                dateRange,
                metric
            };
            
            AnalyticsService.loadAnalyticsData(filters);
        });
    },
    
    // Setup Gmail event listeners
    setupGmailEventListeners: function() {
        // Connect Gmail button
        document.getElementById('connect-gmail-btn').addEventListener('click', function() {
            GmailService.connectGmail();
        });
        
        // Test connection button
        document.getElementById('test-gmail-connection').addEventListener('click', function() {
            const email = document.getElementById('test-gmail-account').value;
            
            if (!email) {
                UIService.showToast('Please select an account to test', 'error');
                return;
            }
            
            GmailService.testGmailConnection(email);
        });
    },
    
    // Setup settings event listeners
    setupSettingsEventListeners: function() {
        // Settings tabs
        const settingsTabButtons = document.querySelectorAll('.settings-tab-btn');
        const settingsTabContents = document.querySelectorAll('.settings-tab-content');
        
        settingsTabButtons.forEach(button => {
            button.addEventListener('click', function() {
                // Remove active class from all buttons
                settingsTabButtons.forEach(btn => {
                    btn.classList.remove('border-indigo-500', 'text-indigo-600');
                    btn.classList.add('border-transparent', 'text-gray-500', 'hover:text-gray-700', 'hover:border-gray-300');
                });
                
                // Add active class to clicked button
                this.classList.add('border-indigo-500', 'text-indigo-600');
                this.classList.remove('border-transparent', 'text-gray-500', 'hover:text-gray-700', 'hover:border-gray-300');
                
                // Hide all tab contents
                settingsTabContents.forEach(content => {
                    content.classList.add('hidden');
                });
                
                // Show corresponding tab content
                const tabId = this.id.replace('-tab', '-content');
                document.getElementById(tabId).classList.remove('hidden');
            });
        });
        
        // Profile form
        document.getElementById('profile-form').addEventListener('submit', async function(e) {
            e.preventDefault();
            
            const firstName = document.getElementById('profile-firstname').value;
            const lastName = document.getElementById('profile-lastname').value;
            const phone = document.getElementById('profile-phone').value;
            
            if (!firstName || !lastName) {
                UIService.showToast('Please fill out your name', 'error');
                return;
            }
            
            await AuthService.updateProfile({
                firstName,
                lastName,
                phone
            });
        });
        
        // Email settings form
        document.getElementById('email-settings-form').addEventListener('submit', async function(e) {
            e.preventDefault();
            
            const defaultSendSpeed = document.getElementById('default-send-speed').value;
            const trackEmailOpens = document.getElementById('track-email-opens').checked;
            const trackLinkClicks = document.getElementById('track-link-clicks').checked;
            const emailSignature = APP_STATE.signatureEditor.root.innerHTML;
            
            await SettingsService.saveEmailSettings({
                defaultSendSpeed,
                trackEmailOpens,
                trackLinkClicks,
                emailSignature
            });
        });
        
        // Notification settings form
        document.getElementById('notification-settings-form').addEventListener('submit', async function(e) {
            e.preventDefault();
            
            const notifyCampaignCompleted = document.getElementById('notify-campaign-completed').checked;
            const notifyLeadReplied = document.getElementById('notify-lead-replied').checked;
            const notifyDailyReports = document.getElementById('notify-daily-reports').checked;
            
            await SettingsService.saveNotificationSettings({
                notifyCampaignCompleted,
                notifyLeadReplied,
                notifyDailyReports
            });
        });
        
        // Security settings form
        document.getElementById('security-settings-form').addEventListener('submit', async function(e) {
            e.preventDefault();
            
            const currentPassword = document.getElementById('current-password').value;
            const newPassword = document.getElementById('new-password').value;
            const confirmPassword = document.getElementById('confirm-password').value;
            
            if (!currentPassword || !newPassword || !confirmPassword) {
                UIService.showToast('Please fill out all fields', 'error');
                return;
            }
            
            if (newPassword !== confirmPassword) {
                UIService.showToast('New passwords do not match', 'error');
                return;
            }
            
            if (newPassword.length < 8) {
                UIService.showToast('New password must be at least 8 characters', 'error');
                return;
            }
            
            await AuthService.changePassword(currentPassword, newPassword);
            
            // Clear password fields
            document.getElementById('current-password').value = '';
            document.getElementById('new-password').value = '';
            document.getElementById('confirm-password').value = '';
        });
    },
    
    // Setup modal event listeners
    setupModalEventListeners: function() {
        // Create Campaign Modal
        this.setupCreateCampaignModal();
        
        // Campaign Details Modal
        this.setupCampaignDetailsModal();
        
        // Lead Details Modal
        this.setupLeadDetailsModal();
        
        // Import Leads Modal
        this.setupImportLeadsModal();
        
        // Add/Edit Lead Modal
        this.setupLeadModal();
        
        // Delete Confirmation Modal
        this.setupDeleteConfirmModal();
    },
    
    // Setup create campaign modal
    setupCreateCampaignModal: function() {
        // Close modal button
        document.getElementById('close-campaign-modal').addEventListener('click', function() {
            UIService.closeCreateCampaignModal();
        });
        
        // Cancel button
        document.getElementById('campaign-cancel-btn').addEventListener('click', function() {
            UIService.closeCreateCampaignModal();
        });
        
        // Step navigation buttons
        document.getElementById('campaign-next-1').addEventListener('click', function() {
            UIService.campaignWizardNextStep(1);
        });
        
        document.getElementById('campaign-prev-2').addEventListener('click', function() {
            UIService.campaignWizardPrevStep(2);
        });
        
        document.getElementById('campaign-next-2').addEventListener('click', function() {
            UIService.campaignWizardNextStep(2);
        });
        
        document.getElementById('campaign-prev-3').addEventListener('click', function() {
            UIService.campaignWizardPrevStep(3);
        });
        
        // Lead source radio buttons
        const leadSourceRadios = document.querySelectorAll('input[name="leadSource"]');
        leadSourceRadios.forEach(radio => {
            radio.addEventListener('change', function() {
                if (this.value === 'upload') {
                    document.getElementById('lead-file-upload-container').classList.remove('hidden');
                    document.getElementById('existing-leads-container').classList.add('hidden');
                } else {
                    document.getElementById('lead-file-upload-container').classList.add('hidden');
                    document.getElementById('existing-leads-container').classList.remove('hidden');
                }
            });
        });
        
        // Lead file upload
        document.getElementById('browse-lead-file').addEventListener('click', function() {
            document.getElementById('lead-file-upload').click();
        });
        
        // document.getElementById('lead-file-upload').addEventListener('change', function() {
        //     if (this.files.length > 0) {
        //         const file = this.files[0];
        //         document.getElementById('lead-file-name').textContent = file.name;
                
        //         // Store file in state
        //         APP_STATE.campaignForm.leadFile = file;
                
        //         // Parse file
        //         CampaignService.parseLeadFile(file)
        //             .then(({ headers, data }) => {
        //                 APP_STATE.campaignForm.leadData = data;
        //                 console.log('Parsed lead data:', headers, data);
        //             })
        //             .catch(error => {
        //                 console.error('Error parsing lead file:', error);
        //                 UIService.showToast('Error parsing file: ' + error.message, 'error');
        //             });
        //     }
        // });
        document.getElementById('lead-file-upload').addEventListener('change', async function() {
            const browseBtn = document.getElementById('browse-lead-file');
        const fileInput = document.getElementById('lead-file-upload');
        const fileName = document.getElementById('lead-file-name');
            if (fileInput.files.length > 0) {
                const file = fileInput.files[0];
                fileName.textContent = file.name;
                APP_STATE.campaignForm.leadFile = file;

                // Parse and verify emails immediately
                const { headers, data } = await CampaignService.parseLeadFile(file);
                APP_STATE.campaignForm.leadData = data;
                const emails = data.map(lead => lead.email).filter(email => email && Utils.validateEmail(email));
                if (emails.length > 0) {
                    const results = await CampaignService.verifyEmails(emails);
                    UIService.renderEmailVerificationResults(results);
                }
            }
        });
        //     if (this.files.length > 0) {
        //         const file = this.files[0];
        //         document.getElementById('lead-file-name').textContent = file.name;
        //         APP_STATE.campaignForm.leadFile = file;
        //         CampaignService.parseLeadFile(file)
        //             .then(({ headers, data }) => {
        //                 APP_STATE.campaignForm.leadData = data;
        //                 console.log('Lead data stored in state:', APP_STATE.campaignForm.leadData); // Add this
        //             })
        //             .catch(error => {
        //                 console.error('Error parsing lead file:', error);
        //                 UIService.showToast('Error parsing file: ' + error.message, 'error');
        //             });
        //     }
        // });
        
        // Add follow-up button
        document.getElementById('add-follow-up').addEventListener('click', function() {
            UIService.addFollowUpEmail();
        });
        
        // Placeholder buttons
        const placeholderButtons = document.querySelectorAll('.placeholder-btn');
        placeholderButtons.forEach(button => {
            button.addEventListener('click', function() {
                if (APP_STATE.quillEditor) {
                    const range = APP_STATE.quillEditor.getSelection(true);
                    APP_STATE.quillEditor.insertText(range.index, this.textContent);
                }
            });
        });
        
        // Campaign form submission
        document.getElementById('campaign-form').addEventListener('submit', async function(e) {
            e.preventDefault();
            
            const campaignName = document.getElementById('campaign-name').value;
            const sendingAccount = document.getElementById('campaign-sending-account').value;
            const emailSubject = document.getElementById('email-subject').value;
            const emailBody = APP_STATE.quillEditor.root.innerHTML;
            const startDate = document.getElementById('campaign-start-date').value;
            const sendSpeed = document.getElementById('campaign-send-speed').value;
            const trackOpens = document.getElementById('campaign-track-opens').checked;
            const trackClicks = document.getElementById('campaign-track-clicks').checked;
            
            // Validate required fields
            if (!campaignName || !sendingAccount || !emailSubject || !emailBody) {
                UIService.showToast('Please fill out all required fields', 'error');
                return;
            }
            
            // Collect follow-ups
            const followUps = [];
            const followUpContainers = document.querySelectorAll('.follow-up-email');
            
            followUpContainers.forEach(container => {
                const subject = container.querySelector('.follow-up-subject').value;
                const body = container.querySelector('.follow-up-body').value;
                const waitDuration = parseInt(container.querySelector('.follow-up-wait-duration').value) || 3;
                const waitUnit = container.querySelector('.follow-up-wait-unit').value;
                
                if (subject && body) {
                    followUps.push({
                        subject,
                        body,
                        waitDuration,
                        waitUnit
                    });
                }
            });
            
            let leads = [];
            let leadSource = document.querySelector('input[name="leadSource"]:checked').value;
            
            if (leadSource === 'upload' && APP_STATE.campaignForm.leadFile) {
                // Prepare leads from file
                leads = APP_STATE.campaignForm.leadData.map((row, index) => ({
                    id: `imported-${index}`,
                    email: row.email || row.Email || row['Email Address'] || '',
                    firstName: row.firstName || row.first_name || row['First Name'] || '',
                    lastName: row.lastName || row.last_name || row['Last Name'] || '',
                    company: row.company || row.Company || row.Organization || '',
                    title: row.title || row.Title || row.Position || row['Job Title'] || '',
                    ...row
                }));
            } else if (leadSource === 'existing') {
                // Use existing leads (would fetch from API in real implementation)
                leads = APP_STATE.leads.filter(lead => lead.status === 'Active');
            }
            
            if (leads.length === 0) {
                UIService.showToast('No leads available for this campaign', 'error');
                return;
            }
            
            // Create campaign data
            const campaignData = {
                campaignName,
                sendingAccount,
                leads,
                emailSubject,
                emailBody,
                startDate: startDate || new Date().toISOString(),
                sendSpeed,
                trackOpens,
                trackClicks,
                followUpEmails: followUps
            };
            console.log(campaignData)
            
            // Create campaign
            const campaignId = await CampaignService.createCampaign(campaignData);
            
            if (campaignId) {
                // If lead file was uploaded, upload it to the campaign
                if (leadSource === 'upload' && APP_STATE.campaignForm.leadFile) {
                    await CampaignService.uploadCampaignLeads(
                        campaignId,
                        APP_STATE.campaignForm.leadFile,
                        { skipFirstRow: true }
                    );
                }
                
                // Start the campaign
                await CampaignService.startCampaign(campaignId);
                
                // Close modal
                UIService.closeCreateCampaignModal();
                
                // Switch to campaigns tab if not already there
                if (APP_STATE.currentTab !== 'campaigns-tab') {
                    document.getElementById('campaigns-link').click();
                }
            }
        });
    },
    renderEmailVerificationResults(results) {
        const container = document.getElementById('email-verification-results');
        const status = document.getElementById('verification-status');
        const details = document.getElementById('verification-details');

        container.classList.remove('hidden');
        const deliverable = results.filter(r => r.status === 'deliverable').length;
        const total = results.length;

        status.textContent = `Verified ${deliverable}/${total} emails as deliverable`;
        details.innerHTML = results.map(result => `
            <li class="${result.status === 'deliverable' ? 'text-green-600' : 'text-red-600'}">
                ${result.email}: ${result.status} (Score: ${result.score}%)
                ${result.error ? ` - ${result.error}` : ''}
            </li>
        `).join('');
    },
    
    // Setup campaign details modal
    setupCampaignDetailsModal: function() {
        // Close button
        document.getElementById('close-campaign-details').addEventListener('click', function() {
            UIService.closeCampaignDetailsModal();
        });
        
        // Pause/Resume button
        document.getElementById('pause-resume-campaign').addEventListener('click', function() {
            if (!APP_STATE.selectedCampaign) return;
            
            const campaignId = APP_STATE.selectedCampaign._id;
            
            if (APP_STATE.selectedCampaign.status === 'Paused') {
                CampaignService.resumeCampaign(campaignId).then(() => {
                    UIService.closeCampaignDetailsModal();
                });
            } else {
                CampaignService.pauseCampaign(campaignId).then(() => {
                    UIService.closeCampaignDetailsModal();
                });
            }
        });
        
        // Delete button
        document.getElementById('delete-campaign').addEventListener('click', function() {
            if (!APP_STATE.selectedCampaign) return;
            
            UIService.openDeleteConfirmModal(
                'campaign',
                APP_STATE.selectedCampaign._id,
                `Are you sure you want to delete the campaign "${APP_STATE.selectedCampaign.name}"? This action cannot be undone.`
            );
        });
    },
    
    // Setup lead details modal
    setupLeadDetailsModal: function() {
        // Close button
        document.getElementById('close-lead-details').addEventListener('click', function() {
            UIService.closeLeadDetailsModal();
        });
        
        // Send direct email button
        document.getElementById('send-direct-email').addEventListener('click', function() {
            if (!APP_STATE.selectedLead) return;
            
            // Open send email functionality (would be implemented)
            UIService.showToast('Send email functionality not implemented yet', 'info');
        });
    },
    
    // Setup import leads modal
    setupImportLeadsModal: function() {
        // Close button
        document.getElementById('close-import-leads').addEventListener('click', function() {
            UIService.closeImportLeadsModal();
        });
        
        // Cancel button
        document.getElementById('cancel-import').addEventListener('click', function() {
            UIService.closeImportLeadsModal();
        });
        
        // Browse button
        document.getElementById('browse-import-file').addEventListener('click', function() {
            document.getElementById('import-file').click();
        });
        
        // File input change
        document.getElementById('import-file').addEventListener('change', function() {
            if (this.files.length > 0) {
                const file = this.files[0];
                document.getElementById('import-file-name').textContent = file.name;
                
                APP_STATE.importLeadsData.file = file;
                
                // Parse file
                CampaignService.parseLeadFile(file)
                    .then(({ headers, data }) => {
                        APP_STATE.importLeadsData.headers = headers;
                        APP_STATE.importLeadsData.data = data;
                        
                        // Set up default mappings
                        const mappings = {};
                        headers.forEach(header => {
                            const lowerHeader = header.toLowerCase();
                            
                            if (lowerHeader.includes('email')) {
                                mappings.email = header;
                            } else if (lowerHeader.includes('first')) {
                                mappings.firstName = header;
                            } else if (lowerHeader.includes('last')) {
                                mappings.lastName = header;
                            } else if (lowerHeader.includes('company') || lowerHeader.includes('organization')) {
                                mappings.company = header;
                            } else if (lowerHeader.includes('title') || lowerHeader.includes('position')) {
                                mappings.title = header;
                            } else if (lowerHeader.includes('industry')) {
                                mappings.industry = header;
                            } else if (lowerHeader.includes('city')) {
                                mappings.city = header;
                            } else if (lowerHeader.includes('state')) {
                                mappings.state = header;
                            } else if (lowerHeader.includes('website') || lowerHeader.includes('url')) {
                                mappings.website = header;
                            }
                        });
                        
                        APP_STATE.importLeadsData.mappings = mappings;
                        
                        // Show mapping container
                        UIService.renderImportMappings();
                        
                        // Show preview
                        UIService.renderImportPreview();
                    })
                    .catch(error => {
                        console.error('Error parsing file:', error);
                        UIService.showToast('Error parsing file: ' + error.message, 'error');
                    });
            }
        });
        
        // Download template link
        document.getElementById('download-template').addEventListener('click', function(e) {
            e.preventDefault();
            
            // Create a template CSV
            const templateHeaders = ['Email', 'First Name', 'Last Name', 'Company', 'Title', 'Industry', 'City', 'State', 'Website'];
            const templateRows = [
                ['example@domain.com', 'John', 'Doe', 'ACME Inc.', 'Marketing Manager', 'Technology', 'New York', 'NY', 'https://www.example.com']
            ];
            
            const csv = [templateHeaders.join(',')].concat(templateRows.map(row => row.join(','))).join('\n');
            
            // Create a blob and download
            const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
            const url = URL.createObjectURL(blob);
            
            const link = document.createElement('a');
            link.setAttribute('href', url);
            link.setAttribute('download', 'leads_import_template.csv');
            link.style.visibility = 'hidden';
            
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
        });
        
        // Import leads form submission
        document.getElementById('import-leads-form').addEventListener('submit', async function(e) {
            e.preventDefault();
            
            if (!APP_STATE.importLeadsData.file) {
                UIService.showToast('Please select a file to import', 'error');
                return;
            }
            
            const skipFirstRow = document.getElementById('skip-first-row').checked;
            const verifyEmails = document.getElementById('verify-emails').checked;
            
            const importOptions = {
                skipFirstRow,
                verifyEmails,
                columnMapping: APP_STATE.importLeadsData.mappings
            };
            
            // Import leads
            await LeadService.importLeads(APP_STATE.importLeadsData.file, importOptions);
            
            // Close modal
            UIService.closeImportLeadsModal();
        });
    },
    
    // Setup lead modal
    setupLeadModal: function() {
        // Close button
        document.getElementById('close-lead-modal').addEventListener('click', function() {
            UIService.closeLeadModal();
        });
        
        // Cancel button
        document.getElementById('cancel-lead').addEventListener('click', function() {
            UIService.closeLeadModal();
        });
        
        // Lead form submission
        document.getElementById('lead-form').addEventListener('submit', async function(e) {
            e.preventDefault();
            
            const leadId = document.getElementById('lead-id').value;
            const firstName = document.getElementById('lead-firstname').value;
            const lastName = document.getElementById('lead-lastname').value;
            const email = document.getElementById('lead-email').value;
            const title = document.getElementById('lead-title').value;
            const company = document.getElementById('lead-company').value;
            const industry = document.getElementById('lead-industry').value;
            const city = document.getElementById('lead-city').value;
            const state = document.getElementById('lead-state').value;
            const website = document.getElementById('lead-website').value;
            
            if (!email) {
                UIService.showToast('Email is required', 'error');
                return;
            }
            
            const leadData = {
                firstName,
                lastName,
                email,
                title,
                company,
                industry,
                city,
                state,
                website
            };
            
            if (leadId) {
                // Update existing lead
                await LeadService.updateLead(leadId, leadData);
            } else {
                // Create new lead
                await LeadService.createLead(leadData);
            }
            
            // Close modal
            UIService.closeLeadModal();
        });
    },
    
    // Setup delete confirmation modal
    setupDeleteConfirmModal: function() {
        // Cancel button
        document.getElementById('cancel-delete').addEventListener('click', function() {
            UIService.closeDeleteConfirmModal();
        });
        
        // Confirm button (handler is set dynamically)
    },
    
    // Initialize rich text editors
    initializeEditors: function() {
        // Email body editor
        APP_STATE.quillEditor = new Quill('#email-body-editor', {
            theme: 'snow',
            placeholder: 'Compose email body...',
            modules: {
                toolbar: [
                    [{ 'header': [1, 2, 3, false] }],
                    ['bold', 'italic', 'underline', 'strike'],
                    [{ 'color': [] }, { 'background': [] }],
                    [{ 'list': 'ordered' }, { 'list': 'bullet' }],
                    ['link', 'image'],
                    ['clean']
                ]
            }
        });
        
        // Signature editor
        APP_STATE.signatureEditor = new Quill('#signature-editor', {
            theme: 'snow',
            placeholder: 'Create your email signature...',
            modules: {
                toolbar: [
                    ['bold', 'italic', 'underline'],
                    [{ 'color': [] }],
                    ['link'],
                    ['clean']
                ]
            }
        });
    },
    
    // Open create campaign modal
    openCreateCampaignModal: function() {
        // Reset form state
        APP_STATE.campaignForm = {
            step: 1,
            leadFile: null,
            leadData: [],
            uploadedLeads: [],
            emailBody: '',
            followUps: []
        };
        
        // Reset form
        document.getElementById('campaign-form').reset();
        
        // Reset file input
        document.getElementById('lead-file-name').textContent = 'No file selected';
        
        // Reset editor content
        APP_STATE.quillEditor.root.innerHTML = '';
        
        // Reset follow-ups
        document.getElementById('follow-ups-container').innerHTML = '';
        
        // Show step 1
        this.campaignWizardGoToStep(1);
        
        // Populate Gmail accounts dropdown
        const accountSelect = document.getElementById('campaign-sending-account');
        accountSelect.innerHTML = '<option value="">Select Gmail account</option>';
        
        APP_STATE.gmailAccounts.forEach(account => {
            accountSelect.innerHTML += `<option value="${account.email}">${account.email}</option>`;
        });
        
        // Show modal
        document.getElementById('create-campaign-modal').classList.remove('hidden');
    },
    
    // Close create campaign modal
    closeCreateCampaignModal: function() {
        document.getElementById('create-campaign-modal').classList.add('hidden');
    },
    
    // Campaign wizard navigation
    campaignWizardGoToStep: function(step) {
        // Update form state
        APP_STATE.campaignForm.step = step;
        
        // Hide all steps
        document.querySelectorAll('.campaign-step').forEach(s => {
            s.classList.add('hidden');
        });
        
        // Show current step
        document.getElementById(`campaign-step-${step}`).classList.remove('hidden');
        
        // Update progress indicators
        const indicators = document.querySelectorAll('.campaign-step-indicator');
        const progressBars = document.querySelectorAll('.campaign-step-progress');
        
        indicators.forEach((indicator, index) => {
            if (index + 1 < step) {
                // Completed step
                indicator.classList.remove('bg-gray-300', 'text-gray-500', 'bg-indigo-600', 'text-white');
                indicator.classList.add('bg-green-500', 'text-white');
                
                // Update icon to checkmark
                indicator.innerHTML = '<i class="fas fa-check"></i>';
            } else if (index + 1 === step) {
                // Current step
                indicator.classList.remove('bg-gray-300', 'text-gray-500', 'bg-green-500');
                indicator.classList.add('bg-indigo-600', 'text-white');
                
                // Restore number
                indicator.innerHTML = index + 1;
            } else {
                // Future step
                indicator.classList.remove('bg-indigo-600', 'text-white', 'bg-green-500');
                indicator.classList.add('bg-gray-300', 'text-gray-500');
                
                // Restore number
                indicator.innerHTML = index + 1;
            }
        });
        
        // Update progress bars
        progressBars.forEach((bar, index) => {
            if (index + 1 < step) {
                bar.style.width = '100%';
            } else {
                bar.style.width = '0%';
            }
        });
    },
    
    // Campaign wizard next step
    campaignWizardNextStep: function(currentStep) {
        if (currentStep === 1) {
          // Validate step 1
          const campaignName = document.getElementById('campaign-name').value;
          const sendingAccount = document.getElementById('campaign-sending-account').value;
          const leadSource = document.querySelector('input[name="leadSource"]:checked').value;
      
          if (!campaignName) {
            this.showToast('Please enter a campaign name', 'error');
            return;
          }
          if (!sendingAccount) {
            this.showToast('Please select a sending account', 'error');
            return;
          }
          if (leadSource === 'upload' && !APP_STATE.campaignForm.leadFile) {
            this.showToast('Please upload a leads file', 'error');
            return;
          }
          if (leadSource === 'existing' && APP_STATE.leads.length === 0) {
            this.showToast('No existing leads available', 'error');
            return;
          }
      
          const emailSubject = document.getElementById('email-subject');
          const quillEditor = APP_STATE.quillEditor;
      
          // Pre-populate initial email
          emailSubject.value = 'Strategic Support for Selling Your Medical Device Business';
          quillEditor.root.innerHTML = `
            <p>Hello {Name},</p>
            <p>I would like to introduce our firm, Cebron Group. We are an investment banking firm specializing in healthcare M&A, with a focus on medical devices, medical device distribution and manufacturing, and medical equipment. We offer comprehensive advisory services tailored to maximize value for our clients during the sale process.</p>
            <p>Our approach includes:</p>
            
              <strong>Extensive Market Access:</strong> We leverage our network of strategic buyers, private equity firms, and industry investors to ensure your business is presented to a broad range of qualified buyers.
              <strong>In-Depth Valuation and Strategic Positioning:</strong> We conduct a detailed analysis to determine your business's optimal valuation and position it to attract competitive offers. This includes assessing growth potential, market position, and operational efficiencies.
              <strong>End-to-End Transaction Support:</strong> We manage every step of the transaction, from initial preparation to buyer identification, due diligence, and negotiation. Our team is experienced in structuring complex deals to achieve favorable terms for sellers.
            <strong>Confidential and Efficient Process:</strong> We prioritize discretion and efficiency, ensuring that your business operations remain unaffected during the sale process while expediting timelines to closure.
            
            <p>If you are considering selling your business, I would be glad to discuss how Cebron can deliver value and secure the best outcome for you. Please let me know if you are available for a 10-minute call.</p>
            <p>Sapna Ravula<br>Cebron Group</p>
          `;
      
          // Pre-populate follow-ups
          const followUpsContainer = document.getElementById('follow-ups-container');
          if (followUpsContainer.children.length === 0) {
            const followUps = [
              {
                subject: 'Strategic Insights for Selling Your Medical Device Business',
                body: `
                  <p>Hello {Name},</p>
                  <p>Following up on my previous message, I want to provide more clarity on how Cebron Group can drive value during the sale process of your home medical device business.</p>
                  <p>We specialize in designing tailored strategies based on your company's unique strengths, market trends, and competitive positioning. Our expertise in the healthcare sector allows us to identify high-value opportunities that align with seller demands, ensuring optimal pricing and terms.</p>
                  <p>If you’re interested in exploring this further, I’d be happy to discuss a more detailed plan during a brief call.</p>
                  <p>Sapna Ravula<br>Cebron Group</p>
                `,
                waitDuration: 1,
                waitUnit: 'days'
              },
              {
                subject: 'Ensuring Transaction Readiness for Your Medical Device Business',
                body: `
                  <p>Hello {Name},</p>
                  <p>I am following up to emphasize one of Cebron Group’s core capabilities: preparing businesses for a transaction-ready state. We conduct a comprehensive analysis to identify potential issues affecting valuation or deal success, allowing us to address these proactively.</p>
                  <p>By preparing your business thoroughly before engaging buyers, we ensure a smoother negotiation process and maximize competitive tension among potential acquirers.</p>
                  <p>If you would like to explore this process in more depth, please let me know when you’re available for a 10-minute call.</p>
                  <p>Sapna Ravula<br>Cebron Group</p>
                `,
                waitDuration: 2,
                waitUnit: 'days'
              },
              {
                subject: 'Using Cebron Group\'s M&A Expertise for Your Sale Process',
                body: `
                  <p>Hello {Name},</p>
                  <p>As a follow-up to our previous emails, I’d like to emphasize what differentiates Cebron in managing M&A transactions for medical device businesses.</p>
                  <p>Our team combines sector-specific insights with financial expertise, providing clients with a clear understanding of deal structures and valuation drivers. We secure offers and enhance terms that deliver higher seller value—whether through cash consideration, earnouts, or equity rollovers, depending on your strategic goals.</p>
                  <p>If you are interested in discussing our approach and how it can benefit your business, please let me know your availability for a brief call.</p>
                  <p>Sapna Ravula<br>Cebron Group</p>
                `,
                waitDuration: 3,
                waitUnit: 'days'
              }
            ];
      
            followUps.forEach(followUp => {
              const followUpDiv = document.createElement('div');
              followUpDiv.className = 'follow-up-email border border-gray-200 rounded-md p-4';
              followUpDiv.innerHTML = `
                <div class="flex justify-between items-center mb-3">
                  <h4 class="text-sm font-medium text-gray-900">Follow-up #${followUps.indexOf(followUp) + 1}</h4>
                  <button type="button" class="remove-follow-up text-red-600 hover:text-red-800">
                    <i class="fas fa-trash"></i>
                  </button>
                </div>
                <div class="space-y-4">
                  <div>
                    <label class="block text-xs font-medium text-gray-700 mb-1">Subject</label>
                    <input type="text" class="follow-up-subject w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-indigo-500 focus:border-indigo-500" value="${followUp.subject}" required>
                  </div>
                  <div>
                    <label class="block text-xs font-medium text-gray-700 mb-1">Body</label>
                    <textarea class="follow-up-body w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-indigo-500 focus:border-indigo-500" rows="5" required>${followUp.body}</textarea>
                  </div>
                  <div>
                    <label class="block text-xs font-medium text-gray-700 mb-1">Send after</label>
                    <div class="grid grid-cols-2 gap-2">
                      <input type="number" class="follow-up-wait-duration w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-indigo-500 focus:border-indigo-500" value="${followUp.waitDuration}" min="1" required>
                      <select class="follow-up-wait-unit w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-indigo-500 focus:border-indigo-500">
                        <option value="minutes" ${followUp.waitUnit === 'minutes' ? 'selected' : ''}>Minutes</option>
                        <option value="hours" ${followUp.waitUnit === 'hours' ? 'selected' : ''}>Hours</option>
                        <option value="days" ${followUp.waitUnit === 'days' ? 'selected' : ''}>Days</option>
                        <option value="weeks" ${followUp.waitUnit === 'weeks' ? 'selected' : ''}>Weeks</option>
                      </select>
                    </div>
                  </div>
                </div>
              `;
              followUpsContainer.appendChild(followUpDiv);
      
              followUpDiv.querySelector('.remove-follow-up').addEventListener('click', function() {
                followUpDiv.remove();
                UIService.updateFollowUpNumbers();
              });
            });
          }
      
          this.campaignWizardGoToStep(2);
        } else if (currentStep === 2) {
          // Validate step 2
          const emailSubject = document.getElementById('email-subject');
          const quillEditor = APP_STATE.quillEditor;
      
          if (!emailSubject.value) {
            emailSubject.value = 'Strategic Support for Selling Your Medical Device Business';
          }
          if (!quillEditor.root.innerHTML || quillEditor.root.innerHTML === '<p><br></p>') {
            quillEditor.root.innerHTML = `
              <p>Hello {Name},</p>
              <p>I would like to introduce our firm, Cebron Group. We are an investment banking firm specializing in healthcare M&A, with a focus on medical devices, medical device distribution and manufacturing, and medical equipment. We offer comprehensive advisory services tailored to maximize value for our clients during the sale process.</p>
              <p>Our approach includes:</p>
              
                <strong>Extensive Market Access:</strong> We leverage our network of strategic buyers, private equity firms, and industry investors to ensure your business is presented to a broad range of qualified buyers.
                <strong>In-Depth Valuation and Strategic Positioning:</strong> We conduct a detailed analysis to determine your business's optimal valuation and position it to attract competitive offers. This includes assessing growth potential, market position, and operational efficiencies.
                <strong>End-to-End Transaction Support:</strong> We manage every step of the transaction, from initial preparation to buyer identification, due diligence, and negotiation. Our team is experienced in structuring complex deals to achieve favorable terms for sellers.
                <strong>Confidential and Efficient Process:</strong> We prioritize discretion and efficiency, ensuring that your business operations remain unaffected during the sale process while expediting timelines to closure.
              
              <p>If you are considering selling your business, I would be glad to discuss how Cebron can deliver value and secure the best outcome for you. Please let me know if you are available for a 10-minute call.</p>
              <p>Sapna Ravula<br>Cebron Group</p>
            `;
          }
      
          // Collect follow-ups
          const followUps = [];
          document.querySelectorAll('.follow-up-email').forEach(followUpDiv => {
            followUps.push({
              subject: followUpDiv.querySelector('.follow-up-subject').value,
              body: followUpDiv.querySelector('.follow-up-body').value,
              waitDuration: parseInt(followUpDiv.querySelector('.follow-up-wait-duration').value),
              waitUnit: followUpDiv.querySelector('.follow-up-wait-unit').value
            });
          });
          APP_STATE.campaignForm.followUps = followUps;
      
          // Update preview
          document.getElementById('summary-campaign-name').textContent = document.getElementById('campaign-name').value;
          document.getElementById('summary-sending-account').textContent = document.getElementById('campaign-sending-account').value;
      
          const leadSource = document.querySelector('input[name="leadSource"]:checked').value;
          let totalLeads = 0;
      
          if (leadSource === 'upload') {
            totalLeads = APP_STATE.campaignForm.leadData.length;
          } else {
            totalLeads = APP_STATE.leads.filter(lead => lead.status === 'Active').length;
          }
      
          document.getElementById('summary-total-leads').textContent = totalLeads;
          document.getElementById('summary-follow-ups').textContent = followUps.length;
      
          document.getElementById('preview-from').textContent = document.getElementById('campaign-sending-account').value;
          document.getElementById('preview-subject').textContent = emailSubject.value;
          document.getElementById('preview-body').innerHTML = quillEditor.root.innerHTML;
      
          // Set current date/time as default
          if (!document.getElementById('campaign-start-date').value) {
            const now = new Date();
            now.setMinutes(now.getMinutes() + 5); // Set to 5 minutes from now
            const dateString = now.toISOString().slice(0, 16);
            document.getElementById('campaign-start-date').value = dateString;
          }
      
          this.campaignWizardGoToStep(3);
        }
      },
    
    // Campaign wizard previous step
    campaignWizardPrevStep: function(currentStep) {
        if (currentStep === 2) {
            this.campaignWizardGoToStep(1);
        } else if (currentStep === 3) {
            this.campaignWizardGoToStep(2);
        }
    },
    
    // Add follow-up email to campaign
    addFollowUpEmail: function() {
        const container = document.getElementById('follow-ups-container');
        const count = container.children.length + 1;
      
        const followUp = document.createElement('div');
        followUp.className = 'follow-up-email border border-gray-200 rounded-md p-4';
        followUp.innerHTML = `
          <div class="flex justify-between items-center mb-3">
            <h4 class="text-sm font-medium text-gray-900">Follow-up #${count}</h4>
            <button type="button" class="remove-follow-up text-red-600 hover:text-red-800">
              <i class="fas fa-trash"></i>
            </button>
          </div>
          <div class="space-y-4">
            <div>
              <label class="block text-xs font-medium text-gray-700 mb-1">Subject</label>
              <input type="text" class="follow-up-subject w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-indigo-500 focus:border-indigo-500" placeholder="Follow-up subject" value="Re: ${document.getElementById('email-subject').value || '[Original Subject]'}" required>
            </div>
            <div>
              <label class="block text-xs font-medium text-gray-700 mb-1">Body</label>
              <textarea class="follow-up-body w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-indigo-500 focus:border-indigo-500" rows="3" placeholder="Follow-up message" required>Hi {first_name},\n\nI wanted to follow up on my previous email. Have you had a chance to consider my proposal?</textarea>
            </div>
            <div>
              <label class="block text-xs font-medium text-gray-700 mb-1">Send after</label>
              <div class="grid grid-cols-2 gap-2">
                <input type="number" class="follow-up-wait-duration w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-indigo-500 focus:border-indigo-500" value="1" min="1" required>
                <select class="follow-up-wait-unit w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-indigo-500 focus:border-indigo-500">
                  <option value="minutes">Minutes</option>
                  <option value="hours">Hours</option>
                  <option value="days">Days</option>
                  <option value="weeks">Weeks</option>
                </select>
              </div>
            </div>
          </div>
        `;
      
        container.appendChild(followUp);
      
        // Add click event for remove button
        followUp.querySelector('.remove-follow-up').addEventListener('click', function() {
          followUp.remove();
          UIService.updateFollowUpNumbers();
        });
      },
    // Update follow-up numbers after deletion
    updateFollowUpNumbers: function() {
        const followUps = document.querySelectorAll('.follow-up-email');
        
        followUps.forEach((followUp, index) => {
            followUp.querySelector('h4').textContent = `Follow-up #${index + 1}`;
        });
    },
    
    // Open campaign details modal
    openCampaignDetailsModal: function(campaign) {
        if (!campaign) return;
        
        // Set campaign title
        document.getElementById('campaign-details-title').textContent = `Campaign: ${campaign.name}`;
        
        // Update campaign stats
        document.getElementById('campaign-detail-status').textContent = campaign.status;
        document.getElementById('campaign-detail-status').className = this.getStatusColorClass(campaign.status);
        
        document.getElementById('campaign-detail-leads').textContent = campaign.leadCount || 0;
        document.getElementById('campaign-detail-sent').textContent = campaign.sentCount || 0;
        document.getElementById('campaign-detail-created').textContent = this.formatDate(campaign.createdAt);
        document.getElementById('campaign-detail-open-rate').textContent = `${campaign.openRate || 0}%`;
        document.getElementById('campaign-detail-click-rate').textContent = `${campaign.clickRate || 0}%`;
        document.getElementById('campaign-detail-reply-rate').textContent = `${campaign.replyRate || 0}%`;
        document.getElementById('campaign-detail-next-followup').textContent = campaign.nextFollowUp ? this.formatDate(campaign.nextFollowUp) : 'N/A';
        
        // Update progress
        const progress = campaign.leadCount > 0 ? Math.round((campaign.sentCount / campaign.leadCount) * 100) : 0;
        document.getElementById('campaign-detail-progress-text').textContent = `${progress}%`;
        document.getElementById('campaign-detail-progress-bar').style.width = `${progress}%`;
        
        // Update initial email
        document.getElementById('initial-email-status').textContent = campaign.initialEmail ? 'Started' : 'Pending';
        document.getElementById('initial-email-subject').textContent = campaign.initialEmail ? campaign.initialEmail.subject : 'N/A';
        document.getElementById('initial-email-body').innerHTML = campaign.initialEmail ? campaign.initialEmail.body : 'N/A';
        
        // Update follow-up emails
        const emailsContainer = document.getElementById('campaign-detail-emails');
        
        // Keep the initial email and remove all follow-ups
        while (emailsContainer.children.length > 1) {
            emailsContainer.removeChild(emailsContainer.lastChild);
        }
        
        // Add follow-up emails
        if (campaign.followUpEmails && campaign.followUpEmails.length > 0) {
            campaign.followUpEmails.forEach((followUp, index) => {
                const followUpElement = document.createElement('div');
                followUpElement.className = 'bg-white border border-gray-200 rounded-md overflow-hidden';
                followUpElement.innerHTML = `
                    <div class="bg-gray-50 px-4 py-2 border-b border-gray-200 flex justify-between items-center">
                        <div class="text-sm font-medium text-gray-900">Follow-up #${index + 1}</div>
                        <div class="text-xs text-gray-500">Send after: ${followUp.waitDuration} ${followUp.waitUnit}</div>
                    </div>
                    <div class="p-4">
                        <div class="mb-2 pb-2 border-b border-gray-200">
                            <div class="text-xs text-gray-500">Subject</div>
                            <div class="text-sm text-gray-900">${followUp.subject}</div>
                        </div>
                        <div>
                            <div class="text-xs text-gray-500">Message</div>
                            <div class="mt-1 prose max-w-none text-sm text-gray-900">${followUp.body}</div>
                        </div>
                    </div>
                `;
                
                emailsContainer.appendChild(followUpElement);
            });
        }
        
        // Update campaign leads
        this.renderCampaignLeads(campaign._id);
        
        // Update pause/resume button text
        const pauseResumeButton = document.getElementById('pause-resume-campaign');
        if (campaign.status === 'Paused') {
            pauseResumeButton.textContent = 'Resume Campaign';
            pauseResumeButton.classList.remove('bg-yellow-600', 'hover:bg-yellow-700');
            pauseResumeButton.classList.add('bg-green-600', 'hover:bg-green-700');
        } else if (campaign.status === 'Active') {
            pauseResumeButton.textContent = 'Pause Campaign';
            pauseResumeButton.classList.remove('bg-green-600', 'hover:bg-green-700');
            pauseResumeButton.classList.add('bg-yellow-600', 'hover:bg-yellow-700');
        } else {
            pauseResumeButton.classList.add('hidden');
        }
        
        // Show modal
        document.getElementById('campaign-details-modal').classList.remove('hidden');
    },
    
    // Close campaign details modal
    closeCampaignDetailsModal: function() {
        document.getElementById('campaign-details-modal').classList.add('hidden');
    },
    
    // Render campaign leads
    async renderCampaignLeads(campaignId) {
        try {
            const leadsContainer = document.getElementById('campaign-leads-table');
            
            // Loading indicator
            leadsContainer.innerHTML = '<tr><td colspan="5" class="px-6 py-4 text-center text-sm text-gray-500">Loading leads...</td></tr>';
            
            // Fetch campaign leads
            const response = await ApiService.call(`/campaigns/${campaignId}`);
            
            if (!response || !response.leads || response.leads.length === 0) {
                leadsContainer.innerHTML = '<tr><td colspan="5" class="px-6 py-4 text-center text-sm text-gray-500">No leads found for this campaign</td></tr>';
                return;
            }
            
            // Render leads
            leadsContainer.innerHTML = response.leads.map(lead => `
                <tr>
                    <td class="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">${lead.email}</td>
                    <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">${this.getLeadStatusBadge(lead.status)}</td>
                    <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">${lead.opens || 0}</td>
                    <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">${lead.clicks || 0}</td>
                    <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        ${lead.lastActivity ? this.formatDate(lead.lastActivity) : 'N/A'}
                    </td>
                </tr>
            `).join('');
        } catch (error) {
            console.error('Error loading campaign leads:', error);
            
            // Error message
            document.getElementById('campaign-leads-table').innerHTML = `
                <tr>
                    <td colspan="5" class="px-6 py-4 text-center text-sm text-red-500">
                        Error loading leads: ${error.message}
                    </td>
                </tr>
            `;
        }
    },
    
    // Open lead details modal
    openLeadDetailsModal: function(lead) {
        if (!lead) return;
        
        // Set lead title
        document.getElementById('lead-details-title').textContent = lead.firstName && lead.lastName ? 
            `${lead.firstName} ${lead.lastName}` : 
            (lead.email || 'Lead Details');
        
        // Update contact info
        document.getElementById('lead-detail-name').textContent = lead.firstName && lead.lastName ? 
            `${lead.firstName} ${lead.lastName}` : 'N/A';
            
        document.getElementById('lead-detail-email').textContent = lead.email || 'N/A';
        document.getElementById('lead-detail-title').textContent = lead.title || 'N/A';
        document.getElementById('lead-detail-status').textContent = lead.status || 'Active';
        
        // Update company info
        document.getElementById('lead-detail-company').textContent = lead.company || 'N/A';
        document.getElementById('lead-detail-industry').textContent = lead.industry || 'N/A';
        document.getElementById('lead-detail-location').textContent = 
            (lead.city || lead.state) ? `${lead.city || ''} ${lead.state || ''}`.trim() : 'N/A';
        
        if (lead.website) {
            document.getElementById('lead-detail-website').innerHTML = `<a href="${lead.website}" target="_blank" class="text-indigo-600 hover:text-indigo-800">${lead.website}</a>`;
        } else {
            document.getElementById('lead-detail-website').textContent = 'N/A';
        }
        
        // Fetch lead activity history and emails
        this.fetchLeadActivity(lead._id);
        
        // Show modal
        document.getElementById('lead-details-modal').classList.remove('hidden');
    },
    
    // Close lead details modal
    closeLeadDetailsModal: function() {
        document.getElementById('lead-details-modal').classList.add('hidden');
    },
    
    // Fetch lead activity
    async fetchLeadActivity(leadId) {
        try {
            const activityTable = document.getElementById('lead-activity-table');
            const emailsContainer = document.getElementById('lead-emails-container');
            
            // Loading indicators
            activityTable.innerHTML = '<tr><td colspan="4" class="px-6 py-4 text-center text-sm text-gray-500">Loading activity...</td></tr>';
            emailsContainer.innerHTML = '<div class="bg-gray-50 p-4 text-center text-sm text-gray-500 rounded-md">Loading emails...</div>';
            
            // Fetch lead activity
            const response = await ApiService.call(`/leads/${leadId}/activity`);
            
            if (!response) {
                activityTable.innerHTML = '<tr><td colspan="4" class="px-6 py-4 text-center text-sm text-gray-500">Error loading activity history</td></tr>';
                emailsContainer.innerHTML = '<div class="bg-gray-50 p-4 text-center text-sm text-gray-500 rounded-md">Error loading emails</div>';
                return;
            }
            
            // Render activity
            if (!response.activities || response.activities.length === 0) {
                activityTable.innerHTML = '<tr><td colspan="4" class="px-6 py-4 text-center text-sm text-gray-500">No activity history found</td></tr>';
            } else {
                activityTable.innerHTML = response.activities.map(activity => `
                    <tr>
                        <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">${this.formatDate(activity.timestamp)}</td>
                        <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">${activity.campaignName || 'N/A'}</td>
                        <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-900">${this.getActivityTypeBadge(activity.type)}</td>
                        <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">${activity.details || ''}</td>
                    </tr>
                `).join('');
            }
            
            // Render emails
            if (!response.emails || response.emails.length === 0) {
                emailsContainer.innerHTML = '<div class="bg-gray-50 p-4 text-center text-sm text-gray-500 rounded-md">No emails have been sent to this lead yet</div>';
            } else {
                emailsContainer.innerHTML = response.emails.map(email => `
                    <div class="bg-white border border-gray-200 rounded-md overflow-hidden mb-4 last:mb-0">
                        <div class="bg-gray-50 px-4 py-2 border-b border-gray-200 flex justify-between items-center">
                            <div class="text-sm font-medium text-gray-900">${email.type === 'FollowUp' ? `Follow-up Email #${email.followUpIndex + 1}` : 'Initial Email'}</div>
                            <div class="text-xs text-gray-500">Sent: ${this.formatDate(email.sentAt)}</div>
                        </div>
                        <div class="p-4">
                            <div class="mb-2 pb-2 border-b border-gray-200">
                                <div class="text-xs text-gray-500">Subject</div>
                                <div class="text-sm text-gray-900">${email.subject}</div>
                            </div>
                            <div>
                                <div class="text-xs text-gray-500">Message</div>
                                <div class="mt-1 prose max-w-none text-sm text-gray-900">${email.body}</div>
                            </div>
                        </div>
                    </div>
                `).join('');
            }
        } catch (error) {
            console.error('Error fetching lead activity:', error);
            
            document.getElementById('lead-activity-table').innerHTML = '<tr><td colspan="4" class="px-6 py-4 text-center text-sm text-red-500">Error loading activity history</td></tr>';
            document.getElementById('lead-emails-container').innerHTML = '<div class="bg-gray-50 p-4 text-center text-sm text-red-500 rounded-md">Error loading emails</div>';
        }
    },
    
    // Open import leads modal
    openImportLeadsModal: function() {
        // Reset form state
        APP_STATE.importLeadsData = {
            file: null,
            headers: [],
            mappings: {},
            data: [],
            skipFirstRow: true
        };
        
        // Reset form
        document.getElementById('import-leads-form').reset();
        document.getElementById('import-file-name').textContent = 'No file selected';
        
        // Hide mapping and preview
        document.getElementById('mapping-container').classList.add('hidden');
        document.getElementById('mapping-placeholder').classList.remove('hidden');
        document.getElementById('preview-container').classList.add('hidden');
        
        // Show modal
        document.getElementById('import-leads-modal').classList.remove('hidden');
    },
    
    // Close import leads modal
    closeImportLeadsModal: function() {
        document.getElementById('import-leads-modal').classList.add('hidden');
    },
    
    // Render import mappings
    renderImportMappings: function() {
        const mappingContainer = document.getElementById('mapping-container');
        mappingContainer.classList.remove('hidden');
        document.getElementById('mapping-placeholder').classList.add('hidden');
        
        const headers = APP_STATE.importLeadsData.headers;
        const mappings = APP_STATE.importLeadsData.mappings;
        
        const fieldOptions = headers.map(header => `<option value="${header}">${header}</option>`).join('');
        
        mappingContainer.innerHTML = `
            <div class="grid grid-cols-2 gap-4">
                <div>
                    <label class="block text-sm font-medium text-gray-700 mb-1">Email</label>
                    <select class="mapping-select w-full px-3 py-2 border border-gray-300 rounded-md" data-field="email">
                        <option value="">-- Select column --</option>
                        ${fieldOptions}
                    </select>
                </div>
                <div>
                    <label class="block text-sm font-medium text-gray-700 mb-1">First Name</label>
                    <select class="mapping-select w-full px-3 py-2 border border-gray-300 rounded-md" data-field="firstName">
                        <option value="">-- Select column --</option>
                        ${fieldOptions}
                    </select>
                </div>
                <div>
                    <label class="block text-sm font-medium text-gray-700 mb-1">Last Name</label>
                    <select class="mapping-select w-full px-3 py-2 border border-gray-300 rounded-md" data-field="lastName">
                        <option value="">-- Select column --</option>
                        ${fieldOptions}
                    </select>
                </div>
                <div>
                    <label class="block text-sm font-medium text-gray-700 mb-1">Company</label>
                    <select class="mapping-select w-full px-3 py-2 border border-gray-300 rounded-md" data-field="company">
                        <option value="">-- Select column --</option>
                        ${fieldOptions}
                    </select>
                </div>
                <div>
                    <label class="block text-sm font-medium text-gray-700 mb-1">Title</label>
                    <select class="mapping-select w-full px-3 py-2 border border-gray-300 rounded-md" data-field="title">
                        <option value="">-- Select column --</option>
                        ${fieldOptions}
                    </select>
                </div>
                <div>
                    <label class="block text-sm font-medium text-gray-700 mb-1">Industry</label>
                    <select class="mapping-select w-full px-3 py-2 border border-gray-300 rounded-md" data-field="industry">
                        <option value="">-- Select column --</option>
                        ${fieldOptions}
                    </select>
                </div>
                <div>
                    <label class="block text-sm font-medium text-gray-700 mb-1">City</label>
                    <select class="mapping-select w-full px-3 py-2 border border-gray-300 rounded-md" data-field="city">
                        <option value="">-- Select column --</option>
                        ${fieldOptions}
                    </select>
                </div>
                <div>
                    <label class="block text-sm font-medium text-gray-700 mb-1">State</label>
                    <select class="mapping-select w-full px-3 py-2 border border-gray-300 rounded-md" data-field="state">
                        <option value="">-- Select column --</option>
                        ${fieldOptions}
                    </select>
                </div>
                <div>
                    <label class="block text-sm font-medium text-gray-700 mb-1">Website</label>
                    <select class="mapping-select w-full px-3 py-2 border border-gray-300 rounded-md" data-field="website">
                        <option value="">-- Select column --</option>
                        ${fieldOptions}
                    </select>
                </div>
            </div>
        `;
        
        // Set selected mappings
        const mappingSelects = document.querySelectorAll('.mapping-select');
        mappingSelects.forEach(select => {
            const field = select.getAttribute('data-field');
            if (mappings[field]) {
                select.value = mappings[field];
            }
            
            // Add change event
            select.addEventListener('change', function() {
                APP_STATE.importLeadsData.mappings[field] = this.value;
            });
        });
    },
    
    // Render import preview
    renderImportPreview: function() {
        const previewContainer = document.getElementById('preview-container');
        previewContainer.classList.remove('hidden');
        
        const headers = APP_STATE.importLeadsData.headers;
        const data = APP_STATE.importLeadsData.data;
        
        // Create header row
        const headerRow = document.getElementById('preview-headers');
        headerRow.innerHTML = headers.map(header => `<th scope="col" class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">${header}</th>`).join('');
        
        // Create data rows
        const previewData = document.getElementById('preview-data');
        
        // Show first 5 rows
        const previewRows = data.slice(0, 5);
        previewData.innerHTML = previewRows.map(row => `
            <tr>
                ${headers.map(header => `<td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">${row[header] || ''}</td>`).join('')}
            </tr>
        `).join('');
    },
    
    // Open add/edit lead modal
    openAddLeadModal: function(lead = null) {
        // Reset form
        document.getElementById('lead-form').reset();
        
        // Set modal title
        document.getElementById('lead-modal-title').textContent = lead ? 'Edit Lead' : 'Add New Lead';
        
        // Set form values if editing
        if (lead) {
            document.getElementById('lead-id').value = lead._id;
            document.getElementById('lead-firstname').value = lead.firstName || '';
            document.getElementById('lead-lastname').value = lead.lastName || '';
            document.getElementById('lead-email').value = lead.email || '';
            document.getElementById('lead-title').value = lead.title || '';
            document.getElementById('lead-company').value = lead.company || '';
            document.getElementById('lead-industry').value = lead.industry || '';
            document.getElementById('lead-city').value = lead.city || '';
            document.getElementById('lead-state').value = lead.state || '';
            document.getElementById('lead-website').value = lead.website || '';
        } else {
            document.getElementById('lead-id').value = '';
        }
        
        // Show modal
        document.getElementById('lead-modal').classList.remove('hidden');
    },
    
    // Close add/edit lead modal
    closeLeadModal: function() {
        document.getElementById('lead-modal').classList.add('hidden');
    },
    
    // Open delete confirmation modal
    openDeleteConfirmModal: function(type, id, message) {
        // Set message
        document.getElementById('delete-confirm-message').textContent = message;
        
        // Set confirm handler
        const confirmButton = document.getElementById('confirm-delete');
        
        // Remove previous event listener
        const newConfirmButton = confirmButton.cloneNode(true);
        confirmButton.parentNode.replaceChild(newConfirmButton, confirmButton);
        
        // Add new event listener
        newConfirmButton.addEventListener('click', async function() {
            if (type === 'campaign') {
                await CampaignService.deleteCampaign(id);
            } else if (type === 'lead') {
                await LeadService.deleteLead(id);
            }
            
            UIService.closeDeleteConfirmModal();
        });
        
        // Show modal
        document.getElementById('delete-confirm-modal').classList.remove('hidden');
    },
    
    // Close delete confirmation modal
    closeDeleteConfirmModal: function() {
        document.getElementById('delete-confirm-modal').classList.add('hidden');
    },
    
    // Switch to tab
    switchTab: function(tabId) {
        // Hide all tabs
        document.querySelectorAll('.tab-content').forEach(tab => {
            tab.classList.add('hidden');
        });
        
        // Show selected tab
        document.getElementById(tabId).classList.remove('hidden');

//         const selectedTab = document.getElementById(tabId);
//   if (selectedTab) {
//     selectedTab.classList.remove('hidden');
//     selectedTab.classList.add('active');
//   } else {
//     console.error(`Tab with ID ${tabId} not found`);
//   }
        
        // Update current tab in state
        APP_STATE.currentTab = tabId;
    },
    
    // Navigate to page
    navigateTo: function(pageId) {
        // Hide all pages
        document.querySelectorAll('.page').forEach(page => {
            page.classList.remove('active');
        });
        
        // Show selected page
        document.getElementById(pageId).classList.add('active');
        
        // Update current page in state
        APP_STATE.currentPage = pageId;
        
        // Update user info if app page
        if (pageId === 'app-page') {
            this.updateUserInfo();
        }
    },
    
    // Update user information display
    updateUserInfo: function() {
        const user = AuthService.getCurrentUser();
        
        if (user) {
            // Update user name
            document.getElementById('user-name').textContent = `${user.firstName} ${user.lastName}`;
            
            // Update user initials
            const initials = user.firstName.charAt(0) + user.lastName.charAt(0);
            document.getElementById('user-initials').textContent = initials;
            
            // Update profile form
            document.getElementById('profile-firstname').value = user.firstName;
            document.getElementById('profile-lastname').value = user.lastName;
            document.getElementById('profile-email').value = user.email;
            document.getElementById('profile-phone').value = user.phone || '';
        }
    },
    
    // Render campaigns table
    renderCampaignsTable: function() {
        const container = document.getElementById('campaigns-table-body');
        
        if (!container) return;
      
        if (APP_STATE.campaigns.length === 0) {
            container.innerHTML = '<tr><td colspan="7" class="px-6 py-4 text-center text-sm text-gray-500">No campaigns found</td></tr>';
            return;
        }
      
        container.innerHTML = APP_STATE.campaigns.map(campaign => {
            // Calculate leads progress (cap at 100%)
            const leadSentCount = campaign.sentCount || 0;
            const leadTotal = campaign.leadCount || 0;
            const leadProgress = leadTotal > 0 ? Math.min(Math.round((Math.min(leadSentCount, leadTotal) / leadTotal) * 100), 100) : 0;
    
            // Calculate follow-up progress with excess sends
            const followUpTotal = campaign.followUpEmails && Array.isArray(campaign.followUpEmails) ? campaign.followUpEmails.length : 0;
            let followUpSentCount = campaign.followUpSentCount || 0;
            // Add excess sends from leads to follow-up count if applicable
            const excessSends = Math.max(leadSentCount - leadTotal, 0);
            followUpSentCount += excessSends;
            const followUpProgress = followUpTotal > 0 ? Math.min(Math.round((followUpSentCount / followUpTotal) * 100), 100) : 0;
    
            return `
                <tr>
                    <td class="px-6 py-4 whitespace-nowrap">
                        <div class="font-medium text-gray-900">${campaign.name}</div>
                    </td>
                    <td class="px-6 py-4 whitespace-nowrap">
                        <span class="px-2 py-1 text-xs rounded-full ${this.getStatusBadgeClass(campaign.status)}">
                            ${campaign.status}
                        </span>
                    </td>
                    <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        ${leadTotal}
                    </td>
                    <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        <div class="flex flex-col items-start">
                            <div class="w-full bg-gray-200 rounded-full h-2 mb-1">
                                <div class="bg-indigo-600 h-2 rounded-full" style="width: ${leadProgress}%"></div>
                            </div>
                            <span class="ml-2 text-xs">Leads: ${Math.min(leadSentCount, leadTotal)}/${leadTotal} (${leadProgress}%)</span>
                            <div class="w-full bg-gray-200 rounded-full h-2 mt-1">
                                <div class="bg-purple-600 h-2 rounded-full" style="width: ${followUpProgress}%"></div>
                            </div>
                            <span class="ml-2 text-xs">Follow-ups: ${followUpSentCount}/${followUpTotal} (${followUpProgress}%)</span>
                        </div>
                    </td>
                    <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        ${this.formatDate(campaign.createdAt)}
                    </td>
                    <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        ${followUpTotal}
                    </td>
                    <td class="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                        <button onclick="CampaignService.getCampaignDetails('${campaign._id}')" class="text-indigo-600 hover:text-indigo-900">
                            View
                        </button>
                    </td>
                </tr>
            `;
        }).join('');
      
        // Update pagination info
        document.getElementById('campaigns-start').textContent = ((APP_STATE.campaignsPagination.page - 1) * APP_STATE.campaignsPagination.limit) + 1;
        document.getElementById('campaigns-end').textContent = Math.min(APP_STATE.campaignsPagination.page * APP_STATE.campaignsPagination.limit, APP_STATE.campaignsPagination.total);
        document.getElementById('campaigns-total').textContent = APP_STATE.campaignsPagination.total;
    },
    // renderCampaignsTable: function() {
    //     const container = document.getElementById('campaigns-table-body');
        
    //     if (!container) return;
      
    //     if (APP_STATE.campaigns.length === 0) {
    //       container.innerHTML = '<tr><td colspan="7" class="px-6 py-4 text-center text-sm text-gray-500">No campaigns found</td></tr>';
    //       return;
    //     }
      
    //     container.innerHTML = APP_STATE.campaigns.map(campaign => `
    //       <tr>
    //         <td class="px-6 py-4 whitespace-nowrap">
    //           <div class="font-medium text-gray-900">${campaign.name}</div>
    //         </td>
    //         <td class="px-6 py-4 whitespace-nowrap">
    //           <span class="px-2 py-1 text-xs rounded-full ${this.getStatusBadgeClass(campaign.status)}">
    //             ${campaign.status}
    //           </span>
    //         </td>
    //         <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
    //           ${campaign.leadCount}
    //         </td>
    //         <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
    //           <div class="flex items-center">
    //             <div class="w-full bg-gray-200 rounded-full h-2">
    //               <div class="bg-indigo-600 h-2 rounded-full" style="width: ${campaign.leadCount > 0 ? Math.round((campaign.sentCount / campaign.leadCount) * 100) : 0}%"></div>
    //             </div>
    //             <span class="ml-2">${campaign.sentCount}/${campaign.leadCount}</span>
    //           </div>
    //         </td>
    //         <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
    //           ${this.formatDate(campaign.createdAt)}
    //         </td>
    //         <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
    //           ${campaign.followUpEmails && Array.isArray(campaign.followUpEmails) ? campaign.followUpEmails.length : '0'}
    //         </td>
    //         <td class="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
    //           <button onclick="CampaignService.getCampaignDetails('${campaign._id}')" class="text-indigo-600 hover:text-indigo-900">
    //             View
    //           </button>
    //         </td>
    //       </tr>
    //     `).join('');
      
    //     // Update pagination info
    //     document.getElementById('campaigns-start').textContent = ((APP_STATE.campaignsPagination.page - 1) * APP_STATE.campaignsPagination.limit) + 1;
    //     document.getElementById('campaigns-end').textContent = Math.min(APP_STATE.campaignsPagination.page * APP_STATE.campaignsPagination.limit, APP_STATE.campaignsPagination.total);
    //     document.getElementById('campaigns-total').textContent = APP_STATE.campaignsPagination.total;
    //   },
    
    // Render campaign details
    renderCampaignDetails: function() {
        if (APP_STATE.selectedCampaign) {
            this.openCampaignDetailsModal(APP_STATE.selectedCampaign);
        }
    },
    
    // Render leads table
    renderLeadsTable: function() {
        const container = document.getElementById('leads-table-body');
        
        if (!container) return;
        
        if (APP_STATE.leads.length === 0) {
            container.innerHTML = '<tr><td colspan="7" class="px-6 py-4 text-center text-sm text-gray-500">No leads found</td></tr>';
            return;
        }
        
        container.innerHTML = APP_STATE.leads.map(lead => `
            <tr>
                <td class="px-6 py-4 whitespace-nowrap">
                    <div class="text-sm font-medium text-gray-900">${lead.firstName} ${lead.lastName}</div>
                </td>
                <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    <a href="mailto:${lead.email}" class="text-indigo-600 hover:text-indigo-900">${lead.email}</a>
                </td>
                <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    ${lead.company || 'N/A'}
                </td>
                <td class="px-6 py-4 whitespace-nowrap">
                    <span class="px-2 py-1 text-xs rounded-full ${this.getLeadStatusBadgeClass(lead.status)}">
                        ${lead.status}
                    </span>
                </td>
                <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    ${lead.lastActivity ? this.formatDate(lead.lastActivity) : 'N/A'}
                </td>
                <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    ${lead.campaign ? lead.campaign.name : 'N/A'}
                </td>
                <td class="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                    <button onclick="LeadService.getLeadDetails('${lead._id}')" class="text-indigo-600 hover:text-indigo-900 mr-2">
                        View
                    </button>
                    <button onclick="UIService.openAddLeadModal(${JSON.stringify(lead).replace(/"/g, '&quot;')})" class="text-indigo-600 hover:text-indigo-900">
                        Edit
                    </button>
                </td>
            </tr>
        `).join('');
        
        // Update pagination info
        document.getElementById('leads-start').textContent = ((APP_STATE.leadsPagination.page - 1) * APP_STATE.leadsPagination.limit) + 1;
        document.getElementById('leads-end').textContent = Math.min(APP_STATE.leadsPagination.page * APP_STATE.leadsPagination.limit, APP_STATE.leadsPagination.total);
        document.getElementById('leads-total').textContent = APP_STATE.leadsPagination.total;
    },
    
    // Render lead details
    renderLeadDetails: function() {
        if (APP_STATE.selectedLead) {
            this.openLeadDetailsModal(APP_STATE.selectedLead);
        }
    },
    
    // Render Gmail accounts
    renderGmailAccounts: function() {
        const container = document.getElementById('connected-accounts-list');
        const statusMessage = document.getElementById('gmail-status-message');
        const testAccountSelect = document.getElementById('test-gmail-account');
        
        if (!container || !statusMessage || !testAccountSelect) return;
        
        if (APP_STATE.gmailAccounts.length === 0) {
            container.innerHTML = '<p class="text-sm text-gray-500">No Gmail accounts are currently connected</p>';
            statusMessage.textContent = "You haven't connected any Gmail accounts yet.";
            testAccountSelect.innerHTML = '<option value="">Select an account</option>';
            
            // Hide test connection container
            document.getElementById('test-connection-container').classList.add('hidden');
            return;
        }
        
        // Update status message
        statusMessage.textContent = `You have ${APP_STATE.gmailAccounts.length} Gmail ${APP_STATE.gmailAccounts.length === 1 ? 'account' : 'accounts'} connected.`;
        
        // Render accounts
        container.innerHTML = APP_STATE.gmailAccounts.map(account => `
            <div class="bg-white rounded-lg border border-gray-200 p-4 flex justify-between items-center">
                <div class="flex items-center">
                    <div class="mr-3 h-10 w-10 rounded-full bg-indigo-100 flex items-center justify-center">
                        <i class="fas fa-envelope text-indigo-600"></i>
                    </div>
                    <div>
                        <div class="font-medium text-gray-900">${account.email}</div>
                        <div class="text-sm text-gray-500">
                            ${account.connected ? 
                                '<span class="text-green-600"><i class="fas fa-check-circle mr-1"></i>Connected</span>' : 
                                '<span class="text-red-600"><i class="fas fa-exclamation-circle mr-1"></i>Disconnected</span>'
                            }
                        </div>
                    </div>
                </div>
                <button class="text-red-600 hover:text-red-800" onclick="GmailService.removeGmailAccount('${account.email}')">
                    <i class="fas fa-trash"></i></button>
            </div>
        `).join('');
        
        // Show test connection container
        document.getElementById('test-connection-container').classList.remove('hidden');
        
        // Update test account select
        testAccountSelect.innerHTML = '<option value="">Select an account</option>' + 
            APP_STATE.gmailAccounts.map(account => `<option value="${account.email}">${account.email}</option>`).join('');
    },
    
    // Show toast notification
showToast: function(message, type = 'info') {
    const container = document.getElementById('toast-container');
    if (!container) return;

    container.classList.remove('hidden');
    
    const toast = document.createElement('div');
    toast.className = 'flash-notification bg-white shadow-lg rounded-lg overflow-hidden max-w-md';
    
    let iconClass, bgClasses;
    switch (type) {
        case 'success':
            iconClass = 'text-green-500';
            bgClasses = ['bg-green-50', 'border-l-4', 'border-green-500'];
            break;
        case 'error':
            iconClass = 'text-red-500';
            bgClasses = ['bg-red-50', 'border-l-4', 'border-red-500'];
            break;
        case 'warning':
            iconClass = 'text-yellow-500';
            bgClasses = ['bg-yellow-50', 'border-l-4', 'border-yellow-500'];
            break;
        default:
            iconClass = 'text-blue-500';
            bgClasses = ['bg-blue-50', 'border-l-4', 'border-blue-500'];
    }
    
    // Apply classes individually
    bgClasses.forEach(cls => toast.classList.add(cls));
    
    toast.innerHTML = `
        <div class="flex items-center p-4">
            <div class="flex-shrink-0">
                <i class="fas fa-${type === 'success' ? 'check-circle' : type === 'error' ? 'exclamation-circle' : type === 'warning' ? 'exclamation-triangle' : 'info-circle'} ${iconClass}"></i>
            </div>
            <div class="ml-3">
                <p class="text-sm">${message}</p>
            </div>
            <div class="ml-auto pl-3">
                <div class="-mx-1.5 -my-1.5">
                    <button class="close-toast inline-flex rounded-md p-1.5 text-gray-500 hover:bg-gray-100 focus:outline-none">
                        <span class="sr-only">Dismiss</span>
                        <i class="fas fa-times"></i>
                    </button>
                </div>
            </div>
        </div>
    `;
    
    container.appendChild(toast);
    
    toast.querySelector('.close-toast').addEventListener('click', function() {
        toast.remove();
        if (container.children.length === 0) {
            container.classList.add('hidden');
        }
    });
    
    setTimeout(() => {
        toast.remove();
        if (container.children.length === 0) {
            container.classList.add('hidden');
        }
    }, CONFIG.TOAST_DURATION);
},
    
    // Show loader
    showLoader: function(message = 'Loading...') {
        const loader = document.getElementById('loader-overlay');
        const loaderText = document.getElementById('loader-text');
        
        if (loader && loaderText) {
            loaderText.textContent = message;
            loader.classList.remove('hidden');
        }
    },
    
    // Hide loader
    hideLoader: function() {
        const loader = document.getElementById('loader-overlay');
        
        if (loader) {
            loader.classList.add('hidden');
        }
    },
    
    // Format date for display
    formatDate: function(dateString) {
        if (!dateString) return 'N/A';
        
        const date = new Date(dateString);
        return date.toLocaleDateString() + ' ' + date.toLocaleTimeString();
    },
    
    // Get status badge class
    getStatusBadgeClass: function(status) {
        switch (status.toLowerCase()) {
            case 'active':
                return 'bg-green-100 text-green-800';
            case 'paused':
                return 'bg-yellow-100 text-yellow-800';
            case 'completed':
                return 'bg-blue-100 text-blue-800';
            case 'draft':
                return 'bg-gray-100 text-gray-800';
            case 'failed':
                return 'bg-red-100 text-red-800';
            default:
                return 'bg-gray-100 text-gray-800';
        }
    },
    
    // Get status color class
    getStatusColorClass: function(status) {
        switch (status.toLowerCase()) {
            case 'active':
                return 'text-green-600 font-medium';
            case 'paused':
                return 'text-yellow-600 font-medium';
            case 'completed':
                return 'text-blue-600 font-medium';
            case 'draft':
                return 'text-gray-600 font-medium';
            case 'failed':
                return 'text-red-600 font-medium';
            default:
                return 'text-gray-600 font-medium';
        }
    },
    
    // Get lead status badge class
    getLeadStatusBadgeClass: function(status) {
        switch (status.toLowerCase()) {
            case 'active':
                return 'bg-green-100 text-green-800';
            case 'replied':
                return 'bg-blue-100 text-blue-800';
            case 'unsubscribed':
                return 'bg-red-100 text-red-800';
            case 'bounced':
                return 'bg-yellow-100 text-yellow-800';
            default:
                return 'bg-gray-100 text-gray-800';
        }
    },
    
    // Get lead status badge
    getLeadStatusBadge: function(status) {
        return `<span class="px-2 py-1 text-xs rounded-full ${this.getLeadStatusBadgeClass(status)}">${status}</span>`;
    },
    
    // Get activity type badge
    getActivityTypeBadge: function(type) {
        let badgeClass, label;
        
        switch (type) {
            case 'email_sent':
                badgeClass = 'bg-blue-100 text-blue-800';
                label = 'Email Sent';
                break;
            case 'email_opened':
                badgeClass = 'bg-green-100 text-green-800';
                label = 'Email Opened';
                break;
            case 'email_clicked':
                badgeClass = 'bg-purple-100 text-purple-800';
                label = 'Link Clicked';
                break;
            case 'email_replied':
                badgeClass = 'bg-indigo-100 text-indigo-800';
                label = 'Email Replied';
                break;
            default:
                badgeClass = 'bg-gray-100 text-gray-800';
                label = type.split('_').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
        }
        
        return `<span class="px-2 py-1 text-xs rounded-full ${badgeClass}">${label}</span>`;
    },
    
    // Debounce function for search inputs
    debounce: function(func, delay) {
        let timeoutId;
        return function(...args) {
            clearTimeout(timeoutId);
            timeoutId = setTimeout(() => func.apply(this, args), delay);
        };
    }
};

// Utility functions
const Utils = {
    // Format date
    formatDate: function(date) {
        return new Date(date).toLocaleDateString();
    },
    
    // Format date and time
    formatDateTime: function(date) {
        return new Date(date).toLocaleString();
    },
    
    // Format currency
    formatCurrency: function(amount) {
        return new Intl.NumberFormat('en-US', {
            style: 'currency',
            currency: 'USD'
        }).format(amount);
    },
    
    // Format number with commas
    formatNumber: function(number) {
        return new Intl.NumberFormat('en-US').format(number);
    },
    
    // Format percentage
    formatPercentage: function(number) {
        return new Intl.NumberFormat('en-US', {
            style: 'percent',
            minimumFractionDigits: 1,
            maximumFractionDigits: 1
        }).format(number / 100);
    },
    
    // Truncate text
    truncateText: function(text, length = 30) {
        if (!text) return '';
        return text.length > length ? text.substring(0, length) + '...' : text;
    },
    
    // Replace template variables in a string
    replaceTemplateVars: function(template, data) {
        return template.replace(/\{([a-zA-Z_]+)\}/g, function(match, key) {
            return data[key] || match;
        });
    },
    
    // Get random color
    getRandomColor: function() {
        const letters = '0123456789ABCDEF';
        let color = '#';
        for (let i = 0; i < 6; i++) {
            color += letters[Math.floor(Math.random() * 16)];
        }
        return color;
    },
    
    // Get initials from name
    getInitials: function(name) {
        if (!name) return '';
        
        const names = name.split(' ');
        if (names.length === 1) return names[0].charAt(0).toUpperCase();
        
        return (names[0].charAt(0) + names[names.length - 1].charAt(0)).toUpperCase();
    },
    
    // Validate email format
    validateEmail: function(email) {
        const re = /^(([^<>()\[\]\\.,;:\s@"]+(\.[^<>()\[\]\\.,;:\s@"]+)*)|(".+"))@((\[[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\])|(([a-zA-Z\-0-9]+\.)+[a-zA-Z]{2,}))$/;
        return re.test(String(email).toLowerCase());
    },
    
    // Generate random ID
    generateId: function() {
        return Date.now().toString(36) + Math.random().toString(36).substr(2);
    }
};

// Initialize the application when DOM is ready
document.addEventListener('DOMContentLoaded', function() {
    // Initialize UI
    UIService.init();
    
    // Make functions available globally for event handlers
    window.UIService = UIService;
    window.AuthService = AuthService;
    window.CampaignService = CampaignService;
    window.LeadService = LeadService;
    window.GmailService = GmailService;
    window.DashboardService = DashboardService;
    window.AnalyticsService = AnalyticsService;
    window.SettingsService = SettingsService;
    window.Utils = Utils;
});