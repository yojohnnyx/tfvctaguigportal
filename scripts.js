function applyTheme(theme) {
  const next = theme === 'dark' ? 'dark' : 'light';
  document.documentElement.dataset.theme = next;
  localStorage.setItem('portalTheme', next);

  document.querySelectorAll('.theme-toggle-button').forEach((button) => {
    button.textContent = next === 'dark' ? 'Switch to light' : 'Switch to dark';
  });
}

function toggleTheme() {
  const current = document.documentElement.dataset.theme;
  applyTheme(current === 'dark' ? 'light' : 'dark');
}

function openModal(id) {
  const modal = document.getElementById(id);
  if (!modal) return;
  modal.classList.add('visible');
  document.body.classList.add('no-scroll');
}

function closeModal(id) {
  const modal = document.getElementById(id);
  if (!modal) return;
  modal.classList.remove('visible');
  document.body.classList.remove('no-scroll');
}

function toggleDevPanelMenu() {
  const panel = document.querySelector('.admin-grid.dev-dashboard .admin-panel');
  const button = document.querySelector('.hamburger-button');
  if (!panel) return;

  const isOpen = panel.classList.toggle('open');
  if (button) {
    button.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
    button.classList.toggle('hidden', isOpen);
  }
  if (isOpen) {
    document.body.classList.add('no-scroll');
  } else {
    document.body.classList.remove('no-scroll');
  }
}

function toggleAdminPanelMenu() {
  const panel = document.getElementById('adminPanelMenu');
  const button = document.querySelector('.admin-hamburger');
  if (!panel) return;

  const isOpen = panel.classList.toggle('open');
  if (button) {
    button.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
    button.classList.toggle('hidden', isOpen);
  }
  document.body.classList.toggle('no-scroll', isOpen);
}

function initTheme() {
  const savedTheme = localStorage.getItem('portalTheme');
  applyTheme(savedTheme === 'dark' ? 'dark' : 'light');
}

function showLoginErrorModal(message) {
  const modal = document.getElementById('loginErrorModal');
  if (!modal) return;
  const messageElement = modal.querySelector('.modal-card p');
  if (messageElement) {
    messageElement.textContent = message;
  }
  openModal('loginErrorModal');
}

function showDevActionModal(message) {
  const modal = document.getElementById('devActionModal');
  if (!modal) return;
  const messageElement = modal.querySelector('#devActionMessage');
  if (messageElement) {
    messageElement.textContent = message;
  }
  openModal('devActionModal');
}

function isValidCreateName(name) {
  const trimmed = String(name || '').trim();
  return trimmed.length > 0 && /^[A-Za-z0-9 .'-]+$/.test(trimmed) && /[A-Za-z]/.test(trimmed);
}

function isValidGmailLocalPart(email) {
  const normalized = String(email || '').trim().toLowerCase();
  const parts = normalized.split('@');
  if (parts.length !== 2) return false;
  const [local, domain] = parts;
  if (!local || !domain) return false;
  if (domain === 'gmail.com' || domain === 'googlemail.com') {
    return /[A-Za-z]/.test(local);
  }
  return true;
}

function showPageStatusMessage(message, type = 'error') {
  const statusMessage = document.getElementById('pageErrorMessage');
  if (!statusMessage) return;
  statusMessage.textContent = message;
  statusMessage.classList.remove('success', 'error');
  statusMessage.classList.add(type === 'success' ? 'success' : 'error');
  statusMessage.style.display = message ? 'block' : 'none';
}

function handlePageErrorsFromQuery() {
  const params = new URLSearchParams(window.location.search);
  const error = params.get('error');
  if (!error) return;

  const messageMap = {
    'invalid-credentials': 'Invalid credentials. Please check your email and password and try again.',
    'login-failed': 'Login failed due to a server error. Please try again in a moment.',
    'account-locked': 'Account locked due to too many failed login attempts. Please try again later.',
    'invalid-email': 'Please enter a valid email address.',
    'password-too-short': 'Password must be at least 6 characters.',
    'missing-fields': 'Please complete all required fields.',
    'password-mismatch': 'Passwords do not match.'
  };

  const message = messageMap[error] || 'An error occurred. Please check your input and try again.';

  if (document.getElementById('loginErrorModal')) {
    if (error === 'invalid-credentials' || error === 'login-failed' || error === 'account-locked') {
      showLoginErrorModal(message);
    } else {
      showPageStatusMessage(message);
    }
  } else {
    showPageStatusMessage(message);
  }

  window.history.replaceState(null, '', window.location.pathname);
}

window.addEventListener('DOMContentLoaded', () => {
  initTheme();
  handlePageErrorsFromQuery();

  document.querySelectorAll('.modal-close').forEach((button) => {
    button.addEventListener('click', () => {
      const modal = button.closest('.modal-backdrop');
      if (modal && modal.dataset.modal) {
        closeModal(modal.dataset.modal);
      }
    });
  });

  document.querySelectorAll('.modal-backdrop').forEach((backdrop) => {
    backdrop.addEventListener('click', (event) => {
      if (event.target === backdrop) {
        closeModal(backdrop.dataset.modal);
      }
    });
  });

  const registerForm = document.getElementById('registerForm');
  if (registerForm) {
    registerForm.addEventListener('submit', (event) => {
      const nameValue = document.getElementById('name')?.value || '';
      const emailValue = document.getElementById('email')?.value || '';
      const majorValue = document.getElementById('major')?.value || '';
      const yearValue = document.getElementById('year')?.value || '';
      const pwd = document.getElementById('password')?.value || '';
      const cpwd = document.getElementById('confirmPassword')?.value || '';
      const emailPattern = /^[A-Za-z0-9@.]+$/;

      if (!isValidCreateName(nameValue)) {
        event.preventDefault();
        showPageStatusMessage('Name must contain letters and may include spaces, numbers, dots, apostrophes, or hyphens only.');
        return;
      }
      if (!emailPattern.test(emailValue) || !emailValue.includes('@') || emailValue.startsWith('@') || emailValue.endsWith('@') || !isValidGmailLocalPart(emailValue)) {
        event.preventDefault();
        showPageStatusMessage('Email can only contain letters, numbers, @, and .; if using Gmail, the local part must include letters.');
        return;
      }
      if (!majorValue || !yearValue) {
        event.preventDefault();
        showPageStatusMessage('Please choose a major and year level.');
        return;
      }
      if (pwd.length < 6) {
        event.preventDefault();
        showPageStatusMessage('Password must be at least 6 characters.');
        return;
      }
      if (pwd !== cpwd) {
        event.preventDefault();
        showPageStatusMessage('Passwords do not match.');
        return;
      }
    });
  }

  const loginForm = document.getElementById('loginForm');
  if (loginForm) {
    loginForm.addEventListener('submit', (event) => {
      const emailValue = document.getElementById('email')?.value || '';
      const pwd = document.getElementById('password')?.value || '';
      const emailPattern = /^[A-Za-z0-9@.]+$/;

      if (!emailPattern.test(emailValue) || !emailValue.includes('@') || emailValue.startsWith('@') || emailValue.endsWith('@') || !isValidGmailLocalPart(emailValue)) {
        event.preventDefault();
        showPageStatusMessage('Email can only contain letters, numbers, @, and .; if using Gmail, the local part must include letters.');
        return;
      }
      if (pwd.length < 6) {
        event.preventDefault();
        showPageStatusMessage('Password must be at least 6 characters.');
        return;
      }
    });
  }

  const searchInput = document.getElementById('studentSearch');
  const majorFilter = document.getElementById('majorFilter');
  const courseFilter = document.getElementById('courseFilter');
  const yearFilter = document.getElementById('yearFilter');
  const sortOrder = document.getElementById('sortOrder');
  const activeFilters = document.getElementById('activeFilters');

  const bindDevActionButtons = () => {
    document.querySelectorAll('.dev-action-button').forEach((button) => {
      button.addEventListener('click', async () => {
        const action = button.dataset.action;
        showDevActionModal('Executing developer action...');
        const messageElement = document.getElementById('devActionMessage');

        try {
          const response = await fetch(`/dev/api/${encodeURIComponent(action)}`);
          if (!response.ok) {
            const errorText = await response.text();
            throw new Error(errorText || `Server returned ${response.status}`);
          }

          const result = await response.json();
          if (result.error) {
            throw new Error(result.error);
          }

          if (action === 'export-users' && result.csv) {
            const blob = new Blob([result.csv], { type: 'text/csv' });
            const url = URL.createObjectURL(blob);
            const anchor = document.createElement('a');
            anchor.href = url;
            anchor.download = result.filename || 'users.csv';
            document.body.appendChild(anchor);
            anchor.click();
            anchor.remove();
            URL.revokeObjectURL(url);
            if (messageElement) {
              messageElement.textContent = `${result.message || 'Export complete.'} Download should start automatically.`;
            }
            return;
          }

          if (action === 'app-logs' && Array.isArray(result.logs)) {
            if (result.logs.length === 0) {
              messageElement.textContent = 'No application logs available yet.';
            } else {
              messageElement.textContent = result.logs.join('\n');
            }
            return;
          }

          if (action === 'health-check' && result.cacheClearedAt !== undefined) {
            messageElement.textContent = `${result.message || 'Health check complete.'}\nUptime: ${result.uptimeSeconds}s\nUsers: ${result.userCount}\nCache entries: ${result.cacheEntries}\nCache cleared at: ${result.cacheClearedAt || 'never'}`;
            return;
          }

          if (messageElement) {
            messageElement.textContent = result.message || JSON.stringify(result);
          }
        } catch (error) {
          if (messageElement) {
            messageElement.textContent = `Action failed: ${error.message}`;
          }
        }
      });
    });
  };

  bindDevActionButtons();

  const applyFilters = () => {
    const searchValue = searchInput?.value.trim().toLowerCase() || '';
    const majorValue = majorFilter?.value.trim().toLowerCase() || '';
    const roleValue = courseFilter?.value.trim().toLowerCase() || '';
    const yearValue = yearFilter?.value.trim().toLowerCase() || '';
    const selectedRole = document.querySelector('.role-summary.active')?.dataset.role || 'all';

    document.querySelectorAll('.student-card, .account-entry').forEach((card) => {
      const nameValue = (card.dataset.name || '').toLowerCase();
      const gradeLevelValue = (card.dataset.gradeLevel || card.dataset.subjects || '').toLowerCase();
      const yearLevelValue = (card.dataset.yearLevel || card.dataset.year || '').toLowerCase();
      const roleText = (card.dataset.role || '').toLowerCase();
      const matchesSearch = !searchValue || nameValue.includes(searchValue) || gradeLevelValue.includes(searchValue) || roleText.includes(searchValue);
      const matchesMajor = !majorValue || gradeLevelValue.includes(majorValue) || roleText === majorValue;
      const matchesRole = !roleValue || roleText === roleValue;
      const matchesYear = !yearValue || yearLevelValue === yearValue;
      const matchesSummary = selectedRole === 'all' || roleText === selectedRole;
      card.dataset.hidden = !(matchesSearch && matchesMajor && matchesRole && matchesYear && matchesSummary);
    });
  };

  const setSummaryRole = (role) => {
    document.querySelectorAll('.role-summary').forEach((button) => {
      button.classList.toggle('active', button.dataset.role === role);
    });
    applyFilters();
  };

  const setupRoleSummaryButtons = () => {
    document.body.addEventListener('click', (event) => {
      const target = event.target.closest('.role-summary');
      if (!target) return;
      setSummaryRole(target.dataset.role);
    });
  };

  const updateAccountEditFieldsVisibility = (role) => {
    const accountGradeField = document.getElementById('accountGradeLevel');
    const accountYearField = document.getElementById('accountYearLevel');
    const accountStudentIdField = document.getElementById('accountStudentId');
    const r = (role || document.getElementById('accountRole')?.value || '').toLowerCase();
    if (['admin', 'staff'].includes(r)) {
      if (accountGradeField) accountGradeField.parentElement.style.display = 'none';
      if (accountYearField) accountYearField.parentElement.style.display = 'none';
      if (accountStudentIdField) accountStudentIdField.parentElement.style.display = 'none';
    } else {
      if (accountGradeField) accountGradeField.parentElement.style.display = '';
      if (accountYearField) accountYearField.parentElement.style.display = '';
      if (accountStudentIdField) accountStudentIdField.parentElement.style.display = '';
    }
  };

  const setupAccountEntries = () => {
    document.body.addEventListener('click', (event) => {
      const entry = event.target.closest('.account-entry');
      if (!entry) return;

      const accountId = entry.dataset.userId;
      const accountName = entry.dataset.name || '';
      const accountEmail = entry.dataset.email || '';
      const accountRole = entry.dataset.role || '';
      const accountGradeLevel = entry.dataset.gradeLevel || '';
      const accountYearLevel = entry.dataset.yearLevel || '';
      const accountStudentId = entry.dataset.studentId || '';

      const accountIdField = document.getElementById('accountId');
      const accountNameField = document.getElementById('accountName');
      const accountEmailField = document.getElementById('accountEmail');
      const accountRoleField = document.getElementById('accountRole');
      const accountPasswordField = document.getElementById('accountPassword');
      const accountConfirmPasswordField = document.getElementById('accountConfirmPassword');
      const accountGradeField = document.getElementById('accountGradeLevel');
      const accountYearField = document.getElementById('accountYearLevel');
      const accountStudentIdField = document.getElementById('accountStudentId');

      if (!accountIdField || !accountNameField || !accountEmailField || !accountRoleField || !accountGradeField || !accountYearField || !accountStudentIdField) {
        return;
      }

      accountIdField.value = accountId;
      accountNameField.value = accountName;
      accountEmailField.value = accountEmail;
      accountRoleField.value = accountRole;
      accountGradeField.value = accountGradeLevel;
      accountYearField.value = accountYearLevel;
      accountStudentIdField.value = accountStudentId;

      // Clear password fields on open
      if (accountPasswordField) accountPasswordField.value = '';
      if (accountConfirmPasswordField) accountConfirmPasswordField.value = '';

      // Set initial visibility based on role
      updateAccountEditFieldsVisibility(accountRole);

      const messageElement = document.getElementById('accountModalMessage');
      if (messageElement) {
        messageElement.textContent = `Editing ${accountName} (${accountRole})`;
      }
      openModal('accountModal');
    });
  };

  const renderStudentDetailModal = (student) => {
    const detailStudentName = document.getElementById('detailStudentName');
    const detailStudentId = document.getElementById('detailStudentId');
    const detailStudentMajor = document.getElementById('detailStudentMajor');
    const detailStudentYear = document.getElementById('detailStudentYear');
    const detailSubjectsTable = document.getElementById('detailSubjectsTable');
    const detailFormStudentId = document.getElementById('detailFormStudentId');
    const detailFormGradeId = document.getElementById('detailFormGradeId');
    const detailSubject = document.getElementById('detailSubject');
    const detailGrade = document.getElementById('detailGrade');
    const detailFormSubmitButton = document.getElementById('detailFormSubmitButton');

    if (!student || !detailStudentName || !detailStudentId || !detailStudentMajor || !detailStudentYear || !detailSubjectsTable || !detailFormStudentId || !detailFormGradeId || !detailSubject || !detailGrade || !detailFormSubmitButton) {
      return;
    }

    detailStudentName.textContent = student.name || 'Student details';
    detailStudentId.textContent = student.studentId || 'N/A';
    detailStudentMajor.textContent = student.major || 'Unknown major';
    detailStudentYear.textContent = student.yearLevel || 'Unspecified year';
    detailFormStudentId.value = student.id;
    detailFormGradeId.value = '';
    detailSubject.value = '';
    detailGrade.value = '';
    detailFormSubmitButton.textContent = 'Add grade';

    if (!Array.isArray(student.grades) || student.grades.length === 0) {
      detailSubjectsTable.innerHTML = '<tr><td colspan="3">No grades recorded yet.</td></tr>';
      return;
    }

    detailSubjectsTable.innerHTML = student.grades
      .map((grade) => `
        <tr data-grade-id="${grade.id}">
          <td>${grade.subject || ''}</td>
          <td>${grade.grade || ''}</td>
          <td><button type="button" class="student-grade-edit" data-user-id="${student.id}" data-grade-id="${grade.id}">Edit</button></td>
        </tr>
      `)
      .join('');
  };

  const setupStudentDetailModal = () => {
    document.body.addEventListener('click', (event) => {
      const target = event.target.closest('.student-card-button');
      if (!target) return;
      event.preventDefault();

      const studentId = target.dataset.userId;
      const student = Array.isArray(window.adminStudentData)
        ? window.adminStudentData.find((item) => String(item.id) === String(studentId))
        : null;

      if (!student) return;
      renderStudentDetailModal(student);
      openModal('studentDetailModal');
    });

    const detailSubjectsTable = document.getElementById('detailSubjectsTable');
    if (!detailSubjectsTable) return;

    detailSubjectsTable.addEventListener('click', (event) => {
      const editButton = event.target.closest('.student-grade-edit');
      if (!editButton) return;

      const gradeId = editButton.dataset.gradeId;
      const studentId = editButton.dataset.userId;
      const student = Array.isArray(window.adminStudentData)
        ? window.adminStudentData.find((item) => String(item.id) === String(studentId))
        : null;
      if (!student) return;

      const grade = Array.isArray(student.grades)
        ? student.grades.find((item) => String(item.id) === String(gradeId))
        : null;
      if (!grade) return;

      const detailFormGradeId = document.getElementById('detailFormGradeId');
      const detailSubject = document.getElementById('detailSubject');
      const detailGrade = document.getElementById('detailGrade');
      const detailFormSubmitButton = document.getElementById('detailFormSubmitButton');

      if (!detailFormGradeId || !detailSubject || !detailGrade || !detailFormSubmitButton) return;

      detailFormGradeId.value = grade.id;
      detailSubject.value = grade.subject || '';
      detailGrade.value = grade.grade || '';
      detailFormSubmitButton.textContent = 'Update grade';
      openModal('studentDetailModal');
    });
  };

  const setupAccountForm = () => {
    const accountEditForm = document.getElementById('accountEditForm');
    if (!accountEditForm) return;

    const accountRoleField = document.getElementById('accountRole');
    if (accountRoleField) {
      accountRoleField.addEventListener('change', (event) => {
        updateAccountEditFieldsVisibility(event.target.value);
      });
    }

    accountEditForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      const formData = new FormData(accountEditForm);
      const pwd = formData.get('password') || '';
      const cpwd = formData.get('confirmPassword') || '';
      const messageElement = document.getElementById('accountModalMessage');
      if (pwd) {
        if (pwd.length < 6) {
          if (messageElement) messageElement.textContent = 'Password must be at least 6 characters.';
          return;
        }
        if (pwd !== cpwd) {
          if (messageElement) messageElement.textContent = 'Passwords do not match.';
          return;
        }
      }
      // If role is admin/staff, ensure we clear course/year/student fields before sending
      if (['admin','staff'].includes((formData.get('role')||'').toLowerCase())) {
        formData.set('gradeLevel', '');
        formData.set('yearLevel', 'N/A');
        formData.set('studentId', '');
      }

      const response = await fetch('/dev/update-user', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: new URLSearchParams(formData)
      });
      const result = await response.json().catch(() => ({ error: 'Unable to update account.' }));
      if (!response.ok || result.error) {
        if (messageElement) {
          messageElement.textContent = result.error || 'Unable to update account.';
        }
        return;
      }

      const accountId = formData.get('id');
      const accountEntry = document.querySelector(`.account-entry[data-user-id="${accountId}"]`);
      if (accountEntry) {
        const updatedName = formData.get('name') || '';
        const updatedEmail = formData.get('email') || '';
        const updatedRole = formData.get('role') || '';
        const updatedGradeLevel = formData.get('gradeLevel') || '';
        const updatedYearLevel = formData.get('yearLevel') || '';
        const updatedStudentId = formData.get('studentId') || '';

        accountEntry.dataset.name = updatedName;
        accountEntry.dataset.email = updatedEmail;
        accountEntry.dataset.role = updatedRole;
        accountEntry.dataset.gradeLevel = updatedGradeLevel;
        accountEntry.dataset.yearLevel = updatedYearLevel;
        accountEntry.dataset.studentId = updatedStudentId;

        const titleEl = accountEntry.querySelector('.account-title');
        const metaEl = accountEntry.querySelector('.account-meta');
        if (titleEl) titleEl.textContent = updatedName;
        if (metaEl) metaEl.textContent = `${updatedRole}${updatedStudentId ? ` • ${updatedStudentId}` : ''}`;
      }

      if (messageElement) {
        messageElement.textContent = result.message || 'User updated successfully.';
      }
    });
  };

  // Show/hide department for create account modal
  const createRoleSelect = document.getElementById('createRole');
  const departmentField = document.getElementById('departmentField');
  if (createRoleSelect) {
    const toggleDept = (role) => {
      const val = role || createRoleSelect.value;
      if (val === 'staff') {
        if (departmentField) departmentField.style.display = '';
      } else {
        if (departmentField) departmentField.style.display = 'none';
      }
    };
    // Tab buttons
    const tabButtons = document.querySelectorAll('.tab-button');
    tabButtons.forEach((btn) => {
      btn.addEventListener('click', () => {
        tabButtons.forEach((b) => b.classList.toggle('active', b === btn));
        const tab = btn.dataset.tab;
        createRoleSelect.value = tab;
        toggleDept(tab);
      });
    });

    const initCreateModal = () => {
      // Prefill from localStorage if available
      try {
        const saved = JSON.parse(localStorage.getItem('createAccountLast') || '{}');
        if (saved.name) document.getElementById('createName').value = saved.name;
        if (saved.email) document.getElementById('createEmail').value = saved.email;
        if (saved.department) document.getElementById('createDepartment').value = saved.department;
        const activeTab = saved.role || 'admin';
        tabButtons.forEach((b) => b.classList.toggle('active', b.dataset.tab === activeTab));
        createRoleSelect.value = activeTab;
        toggleDept(activeTab);
      } catch (e) {
        // ignore
      }
      const messageEl = document.getElementById('createAccountMessage');
      if (messageEl) messageEl.textContent = '';
    };

    // Initialize if modal is already present/visible
    initCreateModal();

    // Save inputs to localStorage as user types
    ['createName', 'createEmail', 'createDepartment'].forEach((id) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.addEventListener('input', () => {
        const prev = JSON.parse(localStorage.getItem('createAccountLast') || '{}');
        prev[id.replace('create', '').toLowerCase()] = el.value;
        prev.role = createRoleSelect.value;
        localStorage.setItem('createAccountLast', JSON.stringify(prev));
      });
    });

    // Validation on submit
    const createForm = document.getElementById('createAccountForm');
    if (createForm) {
      createForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const msg = document.getElementById('createAccountMessage');
        if (msg) {
          msg.classList.remove('error');
          msg.textContent = '';
        }

        const nameValue = document.getElementById('createName')?.value || '';
        const emailValue = document.getElementById('createEmail')?.value || '';
        const pwd = document.getElementById('createPassword')?.value || '';
        const cpwd = document.getElementById('createConfirmPassword')?.value || '';
        const emailPattern = /^[A-Za-z0-9@.]+$/;
        if (!isValidCreateName(nameValue)) {
          if (msg) { msg.textContent = 'Name must contain letters and may include spaces, numbers, dots, apostrophes, or hyphens only.'; msg.classList.add('error'); }
          return;
        }
        if (!emailPattern.test(emailValue) || !emailValue.includes('@') || emailValue.startsWith('@') || emailValue.endsWith('@') || !isValidGmailLocalPart(emailValue)) {
          if (msg) {
            msg.textContent = 'Email can only contain letters, numbers, @, and .; if using Gmail, the local part must include letters.';
            msg.classList.add('error');
          }
          return;
        }
        if (pwd.length < 6) {
          if (msg) { msg.textContent = 'Password must be at least 6 characters.'; msg.classList.add('error'); }
          return;
        }
        if (pwd !== cpwd) {
          if (msg) { msg.textContent = 'Passwords do not match.'; msg.classList.add('error'); }
          return;
        }

        // submit via AJAX to API endpoint
        try {
          const data = new URLSearchParams(new FormData(createForm));
          const res = await fetch('/dev/api/create-account', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: data.toString()
          });
          const result = await res.json().catch(() => ({ error: 'Invalid server response.' }));
          if (!res.ok || result.error) {
            if (msg) { msg.textContent = result.error || 'Unable to create account.'; msg.classList.add('error'); }
            return;
          }

          // success — insert new account entry into the directory
          const newUser = result.user;
          const list = document.querySelector('.account-list');
          if (list && newUser) {
            const safeName = newUser.name;
            const safeEmail = newUser.email;
            const safeRole = newUser.role;
            const safeGrade = newUser.gradeLevel || '';
            const safeYear = newUser.yearLevel || '';
            const safeStudentId = newUser.studentId || '';
            const html = `<button type="button" class="account-entry new-entry" data-user-id="${newUser.id}" data-name="${safeName}" data-email="${safeEmail}" data-role="${safeRole}" data-grade-level="${safeGrade}" data-year-level="${safeYear}" data-student-id="${safeStudentId}">
                  <span class="account-title">${safeName}</span>
                  <span class="account-meta">${safeRole}${safeStudentId ? ` • ${safeStudentId}` : ''}</span>
                  <span class="account-email">${safeEmail}</span>
                </button>`;
            list.insertAdjacentHTML('afterbegin', html);
            const added = document.querySelector(`.account-entry[data-user-id="${newUser.id}"]`);
            if (added) {
              added.scrollIntoView({ behavior: 'smooth', block: 'center' });
              added.classList.add('flash');
              setTimeout(() => added.classList.remove('flash', 'new-entry'), 1600);
            }
          }

          // update overview counts
          try {
            const allBtn = document.querySelector('.overview-item.role-summary.active strong') || document.querySelector('.overview-item .strong');
          } catch (e) {}
          const allCountEl = document.querySelector('.overview-item.role-summary[data-role="all"] strong');
          const roleCountEl = document.querySelector(`.overview-item.role-summary[data-role="${newUser.role}"] strong`);
          if (allCountEl) allCountEl.textContent = String(Number(allCountEl.textContent || 0) + 1);
          if (roleCountEl) roleCountEl.textContent = String(Number(roleCountEl.textContent || 0) + 1);

          if (msg) { msg.textContent = result.message || 'Created account.'; msg.classList.remove('error'); }

          // close modal after a short delay
          setTimeout(() => {
            closeModal('createAccountModal');
            // clear form
            createForm.reset();
            initCreateModal && typeof initCreateModal === 'function' && initCreateModal();
          }, 900);
        } catch (err) {
          if (msg) { msg.textContent = 'Request failed.'; msg.classList.add('error'); }
        }
      });
    }
  }

  const setupDeleteAccount = () => {
    const deleteAccountButton = document.getElementById('deleteAccountButton');
    if (!deleteAccountButton) return;

    deleteAccountButton.addEventListener('click', async () => {
      const accountIdField = document.getElementById('accountId');
      if (!accountIdField) return;
      const accountId = accountIdField.value;

      const response = await fetch('/dev/delete-user', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: new URLSearchParams({ targetId: accountId })
      });

      const messageElement = document.getElementById('accountModalMessage');
      const result = await response.json().catch(() => ({ error: 'Unable to delete account.' }));
      if (!response.ok || result.error) {
        if (messageElement) {
          messageElement.textContent = result.error || 'Unable to delete account.';
        }
        return;
      }

      const accountEntry = document.querySelector(`.account-entry[data-user-id="${accountId}"]`);
      if (accountEntry) {
        accountEntry.remove();
      }
      closeModal('accountModal');
    });
  };

  const updateActiveFilters = () => {
    if (!activeFilters) return;
    const filters = [];
    if (searchInput?.value.trim()) filters.push(`Search: ${searchInput.value.trim()}`);
    if (majorFilter?.value) filters.push(`Major: ${majorFilter.value}`);
    if (courseFilter?.value) filters.push(`Role: ${courseFilter.value}`);
    if (yearFilter?.value) filters.push(`Year: ${yearFilter.value}`);
    if (sortOrder?.value) {
      const label = sortOrder.options[sortOrder.selectedIndex]?.text || sortOrder.value;
      filters.push(`Sort: ${label}`);
    }
    activeFilters.innerHTML = filters.length ? filters.map((text) => `<span>${text}</span>`).join('') : 'No active filters';
  };

  const sortCards = () => {
    if (!sortOrder) return;
    const order = sortOrder.value;
    const container = document.querySelector('.student-list');
    if (!container) return;
    const cards = Array.from(container.querySelectorAll('.student-card'));
    cards.sort((a, b) => {
      const aName = a.dataset.name || '';
      const bName = b.dataset.name || '';
      const aRole = a.dataset.role || '';
      const bRole = b.dataset.role || '';
      const aYear = a.dataset.year || '';
      const bYear = b.dataset.year || '';

      if (order === 'name-asc') return aName.localeCompare(bName);
      if (order === 'name-desc') return bName.localeCompare(aName);
      if (order === 'role') return aRole.localeCompare(bRole);
      if (order === 'year') return aYear.localeCompare(bYear);
      return 0;
    });
    cards.forEach((card) => container.appendChild(card));
  };

  // Initialize account UI handlers even if some filter inputs are absent.
  // The handler functions already guard for missing elements.
  setupAccountEntries();
  setupAccountForm();
  setupDeleteAccount();
  setupRoleSummaryButtons();
  setupStudentDetailModal();

  if (sortOrder) {
    sortOrder.addEventListener('change', () => {
      sortCards();
      applyFilters();
      updateActiveFilters();
    });
  }

  if (searchInput) {
    searchInput.addEventListener('input', () => {
      applyFilters();
      updateActiveFilters();
    });
  }
  if (majorFilter) {
    majorFilter.addEventListener('change', () => {
      applyFilters();
      updateActiveFilters();
    });
  }
  if (courseFilter) {
    courseFilter.addEventListener('change', () => {
      applyFilters();
      updateActiveFilters();
    });
  }
  if (yearFilter) {
    yearFilter.addEventListener('change', () => {
      applyFilters();
      updateActiveFilters();
    });
  }

  const studentGradeForm = document.getElementById('studentGradeForm');
  if (studentGradeForm) {
    studentGradeForm.addEventListener('submit', (event) => {
      const gradeIdField = document.getElementById('detailFormGradeId');
      const submitButton = document.getElementById('detailFormSubmitButton');
      if (gradeIdField && submitButton) {
        submitButton.textContent = gradeIdField.value ? 'Update grade' : 'Add grade';
      }
    });
  }

  window.resetAdminFilters = () => {
    if (searchInput) searchInput.value = '';
    if (majorFilter) majorFilter.value = '';
    if (courseFilter) courseFilter.value = '';
    if (yearFilter) yearFilter.value = '';
    if (sortOrder) sortOrder.value = '';
    sortCards();
    applyFilters();
    updateActiveFilters();
  };

  updateActiveFilters();
});
